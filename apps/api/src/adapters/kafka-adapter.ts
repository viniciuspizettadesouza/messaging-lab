import {
  BROKER_CAPABILITIES,
  type BrokerAdapter,
  type BrokerRunContext,
  type BrokerRunResource,
  type DeliveryHandler,
  type OutboundMessage,
} from '@messaging-lab/shared';
import {
  Kafka,
  logLevel,
  Partitioners,
  type Admin,
  type Consumer,
  type Producer,
} from 'kafkajs';

import { decodeMessage, encodeMessage } from './message-codec.js';
import {
  elapsedHealthCheck,
  resourceSuffix,
  runCleanup,
  type CleanupTask,
} from './support.js';

export class KafkaAdapter implements BrokerAdapter {
  public readonly id = 'kafka' as const;
  public readonly capabilities = BROKER_CAPABILITIES.kafka;
  private readonly kafka: Kafka;

  public constructor(brokers: readonly string[]) {
    this.kafka = new Kafka({
      clientId: 'messaging-lab',
      brokers: [...brokers],
      connectionTimeout: 3_000,
      requestTimeout: 10_000,
      retry: { retries: 2 },
      logLevel: logLevel.NOTHING,
    });
  }

  public async checkHealth() {
    const admin = this.kafka.admin();
    return elapsedHealthCheck(async () => {
      try {
        await admin.connect();
        await admin.listTopics();
      } finally {
        await admin.disconnect();
      }
    });
  }

  public async createRun(
    context: BrokerRunContext,
  ): Promise<BrokerRunResource> {
    const topic = `messaging-lab-${resourceSuffix(context.runId)}`;
    const admin = this.kafka.admin();
    const producer = this.kafka.producer({
      createPartitioner: Partitioners.DefaultPartitioner,
      allowAutoTopicCreation: false,
    });

    try {
      await admin.connect();
      await admin.createTopics({
        waitForLeaders: true,
        topics: [
          {
            topic,
            numPartitions:
              context.scenario === 'competing-consumers'
                ? context.consumerCount
                : 1,
            replicationFactor: 1,
          },
        ],
      });
      await producer.connect();
      return new KafkaRun(topic, admin, producer, this.kafka, context);
    } catch (error) {
      await producer.disconnect().catch(() => undefined);
      await admin.deleteTopics({ topics: [topic] }).catch(() => undefined);
      await admin.disconnect().catch(() => undefined);
      throw error;
    }
  }
}

class KafkaRun implements BrokerRunResource {
  private readonly consumers: Consumer[] = [];
  private readonly topics: string[];
  private readonly backgroundErrors: Error[] = [];
  private publishedMessages = 0;
  private cleaned = false;

  public constructor(
    private readonly topic: string,
    private readonly admin: Admin,
    private readonly producer: Producer,
    private readonly kafka: Kafka,
    private readonly context: BrokerRunContext,
  ) {
    this.topics = [topic];
  }

  public get resourceNames(): readonly string[] {
    return this.topics;
  }

  public async startConsumers(onDelivery: DeliveryHandler): Promise<void> {
    for (let index = 0; index < this.context.consumerCount; index += 1) {
      const consumerId = `kafka-consumer-${index + 1}`;
      const groupId =
        this.context.scenario === 'fan-out'
          ? `${this.topic}-fanout-${index + 1}`
          : `${this.topic}-workers`;
      const consumer = this.kafka.consumer({
        groupId,
        allowAutoTopicCreation: false,
      });
      await consumer.connect();
      await consumer.subscribe({ topic: this.topic, fromBeginning: true });
      this.consumers.push(consumer);
      void consumer
        .run({
          eachMessage: async ({ message }) => {
            if (!message.value)
              throw new Error('Kafka delivered an empty message.');
            await onDelivery(decodeMessage(message.value, consumerId));
          },
        })
        .catch((error: unknown) => {
          if (!this.context.signal.aborted && !this.cleaned) {
            this.backgroundErrors.push(asError(error));
          }
        });
    }
  }

  public async publish(message: OutboundMessage): Promise<void> {
    this.throwBackgroundError();
    await this.producer.send({
      topic: this.topic,
      acks: -1,
      messages: [{ key: message.id, value: encodeMessage(message) }],
    });
    this.publishedMessages += 1;
  }

  public async replay(onDelivery: DeliveryHandler): Promise<void> {
    if (this.publishedMessages === 0) return;

    const consumer = this.kafka.consumer({
      groupId: `${this.topic}-replay-${Date.now()}`,
      allowAutoTopicCreation: false,
    });
    let receivedMessages = 0;
    let resolveReplay: (() => void) | undefined;
    let rejectReplay: ((error: Error) => void) | undefined;
    const replayComplete = new Promise<void>((resolve, reject) => {
      resolveReplay = resolve;
      rejectReplay = reject;
    });
    const timeout = setTimeout(
      () => rejectReplay?.(new Error('Kafka replay timed out.')),
      15_000,
    );

    try {
      await consumer.connect();
      await consumer.subscribe({ topic: this.topic, fromBeginning: true });
      await consumer.run({
        eachMessage: async ({ message }) => {
          if (!message.value)
            throw new Error('Kafka delivered an empty message.');
          await onDelivery(decodeMessage(message.value, 'kafka-replay'));
          receivedMessages += 1;
          if (receivedMessages >= this.publishedMessages) resolveReplay?.();
        },
      });
      await replayComplete;
    } finally {
      clearTimeout(timeout);
      await consumer.stop().catch(() => undefined);
      await consumer.disconnect().catch(() => undefined);
    }
  }

  public async resetReplay(onDelivery: DeliveryHandler): Promise<void> {
    if (this.publishedMessages === 0) return;

    const groupId = `${this.topic}-explicit-offset-reset`;
    const latest = await this.admin.fetchTopicOffsets(this.topic);
    await this.admin.setOffsets({
      groupId,
      topic: this.topic,
      partitions: latest.map(({ partition, offset }) => ({
        partition,
        offset,
      })),
    });
    await this.admin.resetOffsets({
      groupId,
      topic: this.topic,
      earliest: true,
    });

    const consumer = this.kafka.consumer({
      groupId,
      allowAutoTopicCreation: false,
    });
    let receivedMessages = 0;
    let resolveReplay: (() => void) | undefined;
    let rejectReplay: ((error: Error) => void) | undefined;
    const replayComplete = new Promise<void>((resolve, reject) => {
      resolveReplay = resolve;
      rejectReplay = reject;
    });
    const timeout = setTimeout(
      () => rejectReplay?.(new Error('Kafka offset-reset replay timed out.')),
      15_000,
    );

    try {
      await consumer.connect();
      await consumer.subscribe({ topic: this.topic, fromBeginning: true });
      await consumer.run({
        autoCommit: false,
        eachMessage: async ({ message }) => {
          if (!message.value)
            throw new Error('Kafka delivered an empty replay message.');
          await onDelivery(decodeMessage(message.value, 'kafka-offset-reset'));
          receivedMessages += 1;
          if (receivedMessages >= this.publishedMessages) resolveReplay?.();
        },
      });
      await replayComplete;
    } finally {
      clearTimeout(timeout);
      await consumer.stop().catch(() => undefined);
      await consumer.disconnect().catch(() => undefined);
    }
  }

  public async demonstrateRecovery(
    message: OutboundMessage,
    onDelivery: DeliveryHandler,
  ): Promise<void> {
    const recoveryTopic = `${this.topic}-recovery`;
    const groupId = `${recoveryTopic}-group`;
    const failedConsumer = this.kafka.consumer({
      groupId,
      allowAutoTopicCreation: false,
    });
    const recoveredConsumer = this.kafka.consumer({
      groupId,
      allowAutoTopicCreation: false,
    });

    await this.admin.createTopics({
      waitForLeaders: true,
      topics: [
        { topic: recoveryTopic, numPartitions: 1, replicationFactor: 1 },
      ],
    });
    this.topics.push(recoveryTopic);

    try {
      await failedConsumer.connect();
      await failedConsumer.subscribe({
        topic: recoveryTopic,
        fromBeginning: true,
      });
      let markFailedDelivery: (() => void) | undefined;
      const failedDelivery = new Promise<void>((resolve) => {
        markFailedDelivery = resolve;
      });
      await failedConsumer.run({
        autoCommit: false,
        eachMessage: async () => {
          markFailedDelivery?.();
        },
      });
      await this.producer.send({
        topic: recoveryTopic,
        acks: -1,
        messages: [{ key: message.id, value: encodeMessage(message) }],
      });
      await withTimeout(failedDelivery, 'Kafka recovery setup timed out.');
      await failedConsumer.stop();
      await failedConsumer.disconnect();

      let markRecovered: (() => void) | undefined;
      const recoveredDelivery = new Promise<void>((resolve) => {
        markRecovered = resolve;
      });
      await recoveredConsumer.connect();
      await recoveredConsumer.subscribe({
        topic: recoveryTopic,
        fromBeginning: true,
      });
      await recoveredConsumer.run({
        autoCommit: false,
        eachMessage: async ({ message: kafkaMessage, partition }) => {
          if (!kafkaMessage.value) {
            throw new Error('Kafka delivered an empty recovery message.');
          }
          await onDelivery(
            decodeMessage(kafkaMessage.value, 'kafka-recovered-consumer'),
          );
          await recoveredConsumer.commitOffsets([
            {
              topic: recoveryTopic,
              partition,
              offset: (BigInt(kafkaMessage.offset) + 1n).toString(),
            },
          ]);
          markRecovered?.();
        },
      });
      await withTimeout(recoveredDelivery, 'Kafka recovery timed out.');
    } finally {
      await failedConsumer.stop().catch(() => undefined);
      await failedConsumer.disconnect().catch(() => undefined);
      await recoveredConsumer.stop().catch(() => undefined);
      await recoveredConsumer.disconnect().catch(() => undefined);
    }
  }

  public async cleanup() {
    if (this.cleaned) return emptyCleanupReport();
    this.cleaned = true;

    const tasks: CleanupTask[] = this.consumers.map((consumer, index) => ({
      resource: `consumer-${index + 1}`,
      cleanup: async () => {
        try {
          await consumer.stop();
        } finally {
          await consumer.disconnect();
        }
      },
    }));
    tasks.push(
      {
        resource: 'producer',
        cleanup: async () => this.producer.disconnect(),
      },
      {
        resource: this.topic,
        cleanup: async () => {
          await this.admin.deleteTopics({ topics: this.topics });
        },
      },
      {
        resource: 'admin',
        cleanup: async () => this.admin.disconnect(),
      },
    );
    return runCleanup(tasks);
  }

  private throwBackgroundError(): void {
    const error = this.backgroundErrors.shift();
    if (error) throw error;
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function emptyCleanupReport() {
  return { attemptedResources: 0, removedResources: 0, failures: [] };
}

async function withTimeout(
  promise: Promise<void>,
  message: string,
  timeoutMs = 15_000,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}
