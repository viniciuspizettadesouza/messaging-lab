import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { RECOVERY_EXPERIMENT_TYPES } from '@messaging-lab/shared';
import type {
  BrokerAdapter,
  BrokerDelivery,
  BrokerRunResource,
  ScenarioId,
} from '@messaging-lab/shared';

import { KafkaAdapter } from './kafka-adapter.js';
import { RabbitMqAdapter } from './rabbitmq-adapter.js';
import { RedisAdapter } from './redis-adapter.js';
import { RecoveryExperimentEngine } from '../recovery/recovery-engine.js';

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
    async ({ adapter, name, scenario }) => {
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
            globalSequence: index,
            producerId: 'integration-producer',
            producerSequence: index,
            orderingKey: 'integration-producer',
            payload: Buffer.from(`payload-${index}`),
            publishedAtNanoseconds: process.hrtime.bigint(),
          });
        }

        await waitFor(() => deliveries.length === expectedDeliveries);
        expect(deliveries).toHaveLength(expectedDeliveries);
        if (name === 'redis' && scenario === 'fan-out') {
          expect(
            deliveries.every(
              ({ nativeOrderScope }) => nativeOrderScope === null,
            ),
          ).toBe(true);
        } else {
          expect(
            deliveries.every(
              ({ nativeOrderScope }) => nativeOrderScope !== null,
            ),
          ).toBe(true);
        }
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
              globalSequence: 0,
              producerId: 'recovery-producer',
              producerSequence: 0,
              orderingKey: 'recovery-producer',
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

  it.each(RECOVERY_EXPERIMENT_TYPES)(
    'demonstrates and cleans up %s',
    async (type) => {
      const registry = Object.fromEntries(
        adapters.map(({ name, adapter }) => [name, adapter]),
      ) as Record<'redis' | 'kafka' | 'rabbitmq', BrokerAdapter>;
      const result = await new RecoveryExperimentEngine(registry).execute({
        type,
        messageCount: 5,
        interruptAfterMessages: 2,
        timeoutMs: 30_000,
      });

      expect(result.status).toBe('completed');
      expect(result.errors).toEqual([]);
      expect(result.resourceCleanup.failures).toEqual([]);
      if (type === 'redis-pubsub-offline-loss') {
        expect(result.observations.lostMessages).toBe(5);
        expect(result.replay.supported).toBe(false);
      } else {
        expect(result.observations.lostMessages).toBe(0);
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
