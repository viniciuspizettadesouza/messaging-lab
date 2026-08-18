import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type {
  BrokerAdapter,
  BrokerDelivery,
  BrokerRunResource,
  ScenarioId,
} from '@messaging-lab/shared';

import { KafkaAdapter } from './kafka-adapter.js';
import { RabbitMqAdapter } from './rabbitmq-adapter.js';
import { RedisAdapter } from './redis-adapter.js';

const describeIntegration =
  process.env.RUN_BROKER_INTEGRATION === '1' ? describe : describe.skip;
const adapters: Array<{ name: string; adapter: BrokerAdapter }> = [
  {
    name: 'redis',
    adapter: new RedisAdapter(
      process.env.REDIS_URL ?? 'redis://:messaging@localhost:6379',
    ),
  },
  {
    name: 'kafka',
    adapter: new KafkaAdapter(
      (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    ),
  },
  {
    name: 'rabbitmq',
    adapter: new RabbitMqAdapter(
      process.env.RABBITMQ_URL ?? 'amqp://messaging:messaging@localhost:5672',
    ),
  },
];

describeIntegration('broker adapters', () => {
  it.each(adapters)(
    '$name reports protocol-level health',
    async ({ adapter }) => {
      await expect(adapter.checkHealth()).resolves.toMatchObject({
        status: 'healthy',
        error: null,
      });
    },
  );

  it.each(
    adapters.flatMap(({ name, adapter }) =>
      (['fan-out', 'competing-consumers'] as const).map((scenario) => ({
        name,
        adapter,
        scenario,
      })),
    ),
  )(
    '$name delivers $scenario messages with the expected distribution',
    async ({ adapter, scenario }) => {
      const messageCount = 6;
      const consumerCount = 2;
      const expectedDeliveries =
        scenario === 'fan-out' ? messageCount * consumerCount : messageCount;
      const deliveries: BrokerDelivery[] = [];
      const abortController = new AbortController();
      let resource: BrokerRunResource | undefined;

      try {
        resource = await adapter.createRun({
          runId: randomUUID(),
          scenario,
          consumerCount,
          signal: abortController.signal,
        });
        await resource.startConsumers((delivery) => {
          deliveries.push(delivery);
        });

        for (let index = 0; index < messageCount; index += 1) {
          await resource.publish({
            id: `message-${index}`,
            payload: Buffer.from(`payload-${index}`),
            publishedAtNanoseconds: process.hrtime.bigint(),
          });
        }

        await waitFor(() => deliveries.length === expectedDeliveries);
        expect(deliveries).toHaveLength(expectedDeliveries);
        expectDeliveryDistribution(
          deliveries,
          scenario,
          messageCount,
          consumerCount,
        );

        if (resource.replay) {
          const replayed: BrokerDelivery[] = [];
          await resource.replay((delivery) => {
            replayed.push(delivery);
          });
          expect(replayed).toHaveLength(messageCount);
          expect(new Set(replayed.map(({ id }) => id)).size).toBe(messageCount);
        } else {
          expect(adapter.capabilities[scenario].replay).toBe(false);
        }

        if (resource.demonstrateRecovery) {
          const recovered: BrokerDelivery[] = [];
          await resource.demonstrateRecovery(
            {
              id: 'recovery-message',
              payload: Buffer.from('recovery-payload'),
              publishedAtNanoseconds: process.hrtime.bigint(),
            },
            (delivery) => {
              recovered.push(delivery);
            },
          );
          expect(recovered).toHaveLength(1);
          expect(recovered[0]).toMatchObject({ id: 'recovery-message' });
        } else {
          expect(adapter.capabilities[scenario].consumerRecovery).toBe(false);
        }
      } finally {
        abortController.abort();
        if (resource) {
          const cleanup = await resource.cleanup();
          expect(cleanup.failures).toEqual([]);
          await expect(resource.cleanup()).resolves.toEqual({
            attemptedResources: 0,
            removedResources: 0,
            failures: [],
          });
        }
      }
    },
    45_000,
  );
});

function expectDeliveryDistribution(
  deliveries: readonly BrokerDelivery[],
  scenario: ScenarioId,
  messageCount: number,
  consumerCount: number,
): void {
  const countsByMessage = new Map<string, number>();

  for (const delivery of deliveries) {
    countsByMessage.set(
      delivery.id,
      (countsByMessage.get(delivery.id) ?? 0) + 1,
    );
  }

  expect(countsByMessage.size).toBe(messageCount);
  expect([...countsByMessage.values()]).toEqual(
    Array.from({ length: messageCount }, () =>
      scenario === 'fan-out' ? consumerCount : 1,
    ),
  );
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for broker deliveries.');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
