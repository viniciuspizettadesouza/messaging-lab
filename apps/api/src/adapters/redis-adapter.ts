import {
  BROKER_CAPABILITIES,
  type BrokerAdapter,
  type BrokerRunContext,
  type BrokerRunResource,
  type DeliveryHandler,
  type OutboundMessage,
} from '@messaging-lab/shared';
import { createClient } from 'redis';

import { decodeMessage, encodeMessage } from './message-codec.js';
import {
  elapsedHealthCheck,
  resourceSuffix,
  runCleanup,
  type CleanupTask,
} from './support.js';

type RedisClient = ReturnType<typeof newRedisClient>;

export class RedisAdapter implements BrokerAdapter {
  public readonly id = 'redis' as const;
  public readonly capabilities = BROKER_CAPABILITIES.redis;

  public constructor(private readonly url: string) {}

  public async checkHealth() {
    const client = this.createClient();
    return elapsedHealthCheck(async () => {
      try {
        await client.connect();
        await client.ping();
      } finally {
        if (client.isOpen) await client.close();
      }
    });
  }

  public async createRun(
    context: BrokerRunContext,
  ): Promise<BrokerRunResource> {
    const name = `messaging-lab:redis:${resourceSuffix(context.runId)}`;
    const publisher = this.createClient();

    try {
      await publisher.connect();

      if (context.scenario === 'fan-out') {
        return new RedisPubSubRun(name, publisher, context, () =>
          this.createClient(),
        );
      }

      const group = `${name}:group`;
      await publisher.sendCommand([
        'XGROUP',
        'CREATE',
        name,
        group,
        '0',
        'MKSTREAM',
      ]);
      return new RedisStreamsRun(name, group, publisher, context, () =>
        this.createClient(),
      );
    } catch (error) {
      if (publisher.isOpen) await publisher.close().catch(() => undefined);
      throw error;
    }
  }

  private createClient(): RedisClient {
    return newRedisClient(this.url);
  }
}

class RedisPubSubRun implements BrokerRunResource {
  public readonly resourceNames: readonly string[];
  private readonly subscribers: RedisClient[] = [];
  private readonly backgroundErrors: Error[] = [];
  private cleaned = false;

  public constructor(
    private readonly channel: string,
    private readonly publisher: RedisClient,
    private readonly context: BrokerRunContext,
    private readonly createClient: () => RedisClient,
  ) {
    this.resourceNames = [channel];
  }

  public async startConsumers(onDelivery: DeliveryHandler): Promise<void> {
    for (let index = 0; index < this.context.consumerCount; index += 1) {
      const subscriber = this.createClient();
      await subscriber.connect();
      const consumerId = `redis-subscriber-${index + 1}`;
      await subscriber.subscribe(this.channel, (encoded) => {
        void Promise.resolve(
          onDelivery(decodeMessage(encoded, consumerId)),
        ).catch((error: unknown) => {
          this.backgroundErrors.push(asError(error));
        });
      });
      this.subscribers.push(subscriber);
    }
  }

  public async publish(message: OutboundMessage): Promise<void> {
    this.throwBackgroundError();
    await this.publisher.publish(
      this.channel,
      encodeMessage(message).toString(),
    );
  }

  public async cleanup() {
    if (this.cleaned) return emptyCleanupReport();
    this.cleaned = true;

    const tasks: CleanupTask[] = this.subscribers.map((subscriber, index) => ({
      resource: `subscriber-${index + 1}`,
      cleanup: async () => {
        if (subscriber.isOpen) {
          try {
            await subscriber.unsubscribe(this.channel);
          } finally {
            if (subscriber.isOpen) await subscriber.close();
          }
        }
      },
    }));
    tasks.push({
      resource: 'publisher',
      cleanup: async () => {
        if (this.publisher.isOpen) await this.publisher.close();
      },
    });
    return runCleanup(tasks);
  }

  private throwBackgroundError(): void {
    const error = this.backgroundErrors.shift();
    if (error) throw error;
  }
}

class RedisStreamsRun implements BrokerRunResource {
  public readonly resourceNames: readonly string[];
  private readonly consumers: RedisClient[] = [];
  private readonly backgroundErrors: Error[] = [];
  private readonly abortController = new AbortController();
  private cleaned = false;

  public constructor(
    private readonly stream: string,
    private readonly group: string,
    private readonly publisher: RedisClient,
    private readonly context: BrokerRunContext,
    private readonly createClient: () => RedisClient,
  ) {
    this.resourceNames = [stream, group];
    context.signal.addEventListener(
      'abort',
      () => this.abortController.abort(),
      {
        once: true,
      },
    );
  }

  public async startConsumers(onDelivery: DeliveryHandler): Promise<void> {
    for (let index = 0; index < this.context.consumerCount; index += 1) {
      const consumer = this.createClient();
      await consumer.connect();
      this.consumers.push(consumer);
      const consumerId = `redis-worker-${index + 1}`;
      void this.consume(consumer, consumerId, onDelivery).catch(
        (error: unknown) => {
          if (!this.abortController.signal.aborted) {
            this.backgroundErrors.push(asError(error));
          }
        },
      );
    }
  }

  public async publish(message: OutboundMessage): Promise<void> {
    this.throwBackgroundError();
    await this.publisher.sendCommand([
      'XADD',
      this.stream,
      '*',
      'message',
      encodeMessage(message),
    ]);
  }

  public async replay(onDelivery: DeliveryHandler): Promise<void> {
    const response = await this.publisher.sendCommand([
      'XRANGE',
      this.stream,
      '-',
      '+',
    ]);

    for (const entry of parseStreamEntries(response)) {
      await onDelivery(
        decodeMessage(entry.encoded, 'redis-replay', `stream:${this.stream}`),
      );
    }
  }

  public async demonstrateRecovery(
    message: OutboundMessage,
    onDelivery: DeliveryHandler,
  ): Promise<void> {
    const recoveryGroup = `${this.group}:recovery`;
    const source = this.createClient();
    const recovered = this.createClient();

    try {
      await this.publisher.sendCommand([
        'XGROUP',
        'CREATE',
        this.stream,
        recoveryGroup,
        '$',
        'MKSTREAM',
      ]);
      await this.publisher.sendCommand([
        'XADD',
        this.stream,
        '*',
        'message',
        encodeMessage(message),
      ]);
      await source.connect();
      const pending = await source.sendCommand([
        'XREADGROUP',
        'GROUP',
        recoveryGroup,
        'failed-consumer',
        'COUNT',
        '1',
        'STREAMS',
        this.stream,
        '>',
      ]);

      if (parseReadGroupResponse(pending).length !== 1) {
        throw new Error(
          'Redis recovery setup did not create a pending message.',
        );
      }

      await source.close();
      await recovered.connect();
      const claimed = await recovered.sendCommand([
        'XAUTOCLAIM',
        this.stream,
        recoveryGroup,
        'recovered-consumer',
        '0',
        '0-0',
        'COUNT',
        '1',
      ]);
      const [entry] = parseAutoClaimResponse(claimed);

      if (!entry) throw new Error('Redis did not recover the pending message.');
      await onDelivery(
        decodeMessage(
          entry.encoded,
          'redis-recovered-consumer',
          `stream:${this.stream}`,
        ),
      );
      await recovered.sendCommand([
        'XACK',
        this.stream,
        recoveryGroup,
        entry.id,
      ]);
    } finally {
      if (source.isOpen) await source.close().catch(() => undefined);
      if (recovered.isOpen) await recovered.close().catch(() => undefined);
      if (this.publisher.isOpen) {
        await this.publisher
          .sendCommand(['XGROUP', 'DESTROY', this.stream, recoveryGroup])
          .catch(() => undefined);
      }
    }
  }

  public async cleanup() {
    if (this.cleaned) return emptyCleanupReport();
    this.cleaned = true;
    this.abortController.abort();

    const tasks: CleanupTask[] = this.consumers.map((consumer, index) => ({
      resource: `consumer-${index + 1}`,
      cleanup: async () => {
        if (consumer.isOpen) await consumer.close();
      },
    }));
    tasks.push(
      {
        resource: this.stream,
        cleanup: async () => {
          if (this.publisher.isOpen) await this.publisher.del(this.stream);
        },
      },
      {
        resource: 'publisher',
        cleanup: async () => {
          if (this.publisher.isOpen) await this.publisher.close();
        },
      },
    );
    return runCleanup(tasks);
  }

  private async consume(
    consumer: RedisClient,
    consumerId: string,
    onDelivery: DeliveryHandler,
  ): Promise<void> {
    while (!this.abortController.signal.aborted) {
      const response = await consumer.sendCommand([
        'XREADGROUP',
        'GROUP',
        this.group,
        consumerId,
        'COUNT',
        '10',
        'BLOCK',
        '100',
        'STREAMS',
        this.stream,
        '>',
      ]);

      for (const entry of parseReadGroupResponse(response)) {
        await onDelivery(
          decodeMessage(entry.encoded, consumerId, `stream:${this.stream}`),
        );
        await consumer.sendCommand(['XACK', this.stream, this.group, entry.id]);
      }
    }
  }

  private throwBackgroundError(): void {
    const error = this.backgroundErrors.shift();
    if (error) throw error;
  }
}

interface StreamEntry {
  readonly id: string;
  readonly encoded: Buffer | string;
}

function parseReadGroupResponse(value: unknown): StreamEntry[] {
  if (Array.isArray(value)) {
    const stream = value[0];
    return Array.isArray(stream) ? parseStreamEntries(stream[1]) : [];
  }

  if (value && typeof value === 'object') {
    const entries = Object.values(value)[0];
    return parseStreamEntries(entries);
  }

  return [];
}

function parseStreamEntries(value: unknown): StreamEntry[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry): StreamEntry[] => {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') return [];
    const fields = entry[1];
    if (!Array.isArray(fields)) return [];
    const messageIndex = fields.findIndex((field) => field === 'message');
    const encoded = fields[messageIndex + 1];
    return typeof encoded === 'string' || Buffer.isBuffer(encoded)
      ? [{ id: entry[0], encoded }]
      : [];
  });
}

function parseAutoClaimResponse(value: unknown): StreamEntry[] {
  return Array.isArray(value) ? parseStreamEntries(value[1]) : [];
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function emptyCleanupReport() {
  return { attemptedResources: 0, removedResources: 0, failures: [] };
}

function newRedisClient(url: string) {
  const client = createClient({
    url,
    socket: { connectTimeout: 3_000, reconnectStrategy: false },
  });
  client.on('error', () => undefined);
  return client;
}
