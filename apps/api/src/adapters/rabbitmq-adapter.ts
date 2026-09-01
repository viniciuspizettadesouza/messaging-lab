import {
  BROKER_CAPABILITIES,
  type BrokerAdapter,
  type BrokerRunContext,
  type BrokerRunResource,
  type DeliveryHandler,
  type OutboundMessage,
} from '@messaging-lab/shared';
import {
  connect,
  type ChannelModel,
  type Channel,
  type ConfirmChannel,
  type ConsumeMessage,
  type GetMessage,
} from 'amqplib';

import { decodeMessage, encodeMessage } from './message-codec.js';
import {
  elapsedHealthCheck,
  resourceSuffix,
  runCleanup,
  type CleanupTask,
} from './support.js';

export class RabbitMqAdapter implements BrokerAdapter {
  public readonly id = 'rabbitmq' as const;
  public readonly capabilities = BROKER_CAPABILITIES.rabbitmq;

  public constructor(private readonly url: string) {}

  public async checkHealth() {
    let connection: ChannelModel | undefined;
    return elapsedHealthCheck(async () => {
      try {
        connection = await openConnection(this.url);
        const channel = await connection.createChannel();
        await channel.close();
      } finally {
        await connection?.close();
      }
    });
  }

  public async createRun(
    context: BrokerRunContext,
  ): Promise<BrokerRunResource> {
    const suffix = resourceSuffix(context.runId);
    const connection = await openConnection(this.url);
    const channel = await connection.createConfirmChannel();
    const exchange = `messaging-lab.${suffix}.fanout`;
    const queuePrefix = `messaging-lab.${suffix}`;

    try {
      await channel.prefetch(100);

      if (context.scenario === 'fan-out') {
        await channel.assertExchange(exchange, 'fanout', {
          durable: true,
          autoDelete: false,
        });
      } else {
        await channel.assertQueue(`${queuePrefix}.workers`, {
          durable: true,
          autoDelete: false,
        });
      }

      return new RabbitMqRun(
        connection,
        channel,
        exchange,
        queuePrefix,
        context,
      );
    } catch (error) {
      if (context.scenario === 'fan-out') {
        await channel.deleteExchange(exchange).catch(() => undefined);
      } else {
        await channel
          .deleteQueue(`${queuePrefix}.workers`)
          .catch(() => undefined);
      }
      await channel.close().catch(() => undefined);
      await connection.close().catch(() => undefined);
      throw error;
    }
  }
}

class RabbitMqRun implements BrokerRunResource {
  private readonly queues: string[] = [];
  private readonly consumerTags: string[] = [];
  private readonly backgroundErrors: Error[] = [];
  private cleaned = false;

  public constructor(
    private readonly connection: ChannelModel,
    private readonly channel: ConfirmChannel,
    private readonly exchange: string,
    private readonly queuePrefix: string,
    private readonly context: BrokerRunContext,
  ) {}

  public get resourceNames(): readonly string[] {
    return this.context.scenario === 'fan-out'
      ? [this.exchange, ...this.queues]
      : [`${this.queuePrefix}.workers`];
  }

  public async startConsumers(onDelivery: DeliveryHandler): Promise<void> {
    for (let index = 0; index < this.context.consumerCount; index += 1) {
      const consumerId = `rabbitmq-consumer-${index + 1}`;
      const queue =
        this.context.scenario === 'fan-out'
          ? `${this.queuePrefix}.fanout.${index + 1}`
          : `${this.queuePrefix}.workers`;

      if (this.context.scenario === 'fan-out') {
        await this.channel.assertQueue(queue, {
          durable: true,
          autoDelete: false,
        });
        await this.channel.bindQueue(queue, this.exchange, '');
      }

      if (!this.queues.includes(queue)) this.queues.push(queue);
      const result = await this.channel.consume(
        queue,
        (message) =>
          this.handleDelivery(message, consumerId, queue, onDelivery),
        { noAck: false },
      );
      this.consumerTags.push(result.consumerTag);
    }
  }

  public async publish(message: OutboundMessage): Promise<void> {
    this.throwBackgroundError();
    const encoded = encodeMessage(message);

    await new Promise<void>((resolve, reject) => {
      const callback = (error: unknown) => {
        if (error) reject(asError(error));
        else resolve();
      };

      if (this.context.scenario === 'fan-out') {
        this.channel.publish(
          this.exchange,
          '',
          encoded,
          { persistent: true },
          callback,
        );
      } else {
        this.channel.sendToQueue(
          `${this.queuePrefix}.workers`,
          encoded,
          { persistent: true },
          callback,
        );
      }
    });
  }

  public async demonstrateRecovery(
    message: OutboundMessage,
    onDelivery: DeliveryHandler,
  ): Promise<void> {
    const queue = `${this.queuePrefix}.recovery`;
    const failedChannel = await this.connection.createChannel();

    try {
      await this.channel.assertQueue(queue, {
        durable: true,
        autoDelete: false,
      });
      if (this.context.scenario === 'fan-out') {
        await this.channel.bindQueue(queue, this.exchange, '');
      }
      if (!this.queues.includes(queue)) this.queues.push(queue);

      await this.publishToRecoveryQueue(message, queue);
      const unacknowledged = await waitForMessage(failedChannel, queue);
      if (!unacknowledged) {
        throw new Error('RabbitMQ recovery setup did not receive a message.');
      }

      await failedChannel.close();
      const recovered = await waitForMessage(this.channel, queue);
      if (!recovered) throw new Error('RabbitMQ did not requeue the message.');
      await onDelivery(
        decodeMessage(
          recovered.content,
          'rabbitmq-recovered-consumer',
          `queue:${queue}`,
        ),
      );
      this.channel.ack(recovered);
    } finally {
      await failedChannel.close().catch(() => undefined);
    }
  }

  public async cleanup() {
    if (this.cleaned) return emptyCleanupReport();
    this.cleaned = true;

    const tasks: CleanupTask[] = this.consumerTags.map((consumerTag) => ({
      resource: consumerTag,
      cleanup: async () => {
        await this.channel.cancel(consumerTag);
      },
    }));
    tasks.push(
      ...this.queues.map((queue) => ({
        resource: queue,
        cleanup: async () => {
          await this.channel.deleteQueue(queue);
        },
      })),
    );

    if (this.context.scenario === 'fan-out') {
      tasks.push({
        resource: this.exchange,
        cleanup: async () => {
          await this.channel.deleteExchange(this.exchange);
        },
      });
    }

    tasks.push(
      {
        resource: 'channel',
        cleanup: async () => this.channel.close(),
      },
      {
        resource: 'connection',
        cleanup: async () => this.connection.close(),
      },
    );
    return runCleanup(tasks);
  }

  private handleDelivery(
    message: ConsumeMessage | null,
    consumerId: string,
    queue: string,
    onDelivery: DeliveryHandler,
  ): void {
    if (!message) return;

    void Promise.resolve(
      onDelivery(decodeMessage(message.content, consumerId, `queue:${queue}`)),
    )
      .then(() => this.channel.ack(message))
      .catch((error: unknown) => {
        this.backgroundErrors.push(asError(error));
        this.channel.nack(message, false, false);
      });
  }

  private throwBackgroundError(): void {
    const error = this.backgroundErrors.shift();
    if (error) throw error;
  }

  private async publishToRecoveryQueue(
    message: OutboundMessage,
    queue: string,
  ): Promise<void> {
    const encoded = encodeMessage(message);
    await new Promise<void>((resolve, reject) => {
      const callback = (error: unknown) => {
        if (error) reject(asError(error));
        else resolve();
      };

      if (this.context.scenario === 'fan-out') {
        this.channel.publish(
          this.exchange,
          '',
          encoded,
          { persistent: true },
          callback,
        );
      } else {
        this.channel.sendToQueue(
          queue,
          encoded,
          { persistent: true },
          callback,
        );
      }
    });
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function emptyCleanupReport() {
  return { attemptedResources: 0, removedResources: 0, failures: [] };
}

async function waitForMessage(
  channel: Channel,
  queue: string,
  timeoutMs = 5_000,
): Promise<GetMessage | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const message = await channel.get(queue, { noAck: false });
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return null;
}

async function openConnection(url: string): Promise<ChannelModel> {
  const connection = await connect(url, { timeout: 3_000 });
  connection.on('error', () => undefined);
  return connection;
}
