import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  BENCHMARK_DEFAULTS,
  type BrokerAdapter,
  type BrokerId,
  type ScenarioId,
} from '@messaging-lab/shared';

import { KafkaAdapter } from '../adapters/kafka-adapter.js';
import { RabbitMqAdapter } from '../adapters/rabbitmq-adapter.js';
import { RedisAdapter } from '../adapters/redis-adapter.js';
import { BenchmarkEngine } from './benchmark-engine.js';

const describeIntegration =
  process.env.RUN_BROKER_INTEGRATION === '1' ? describe : describe.skip;
const adapters: Array<{ name: BrokerId; adapter: BrokerAdapter }> = [
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

describeIntegration('complete benchmark runs', () => {
  it.each(
    adapters.flatMap(({ name, adapter }) =>
      (['fan-out', 'competing-consumers'] as const).map((scenario) => ({
        name,
        adapter,
        scenario,
      })),
    ),
  )(
    '$name completes a $scenario benchmark',
    async ({ adapter, name, scenario }) => {
      const metrics = await executeBenchmark(adapter, name, scenario);

      expect(metrics).toMatchObject({
        publishedMessages: 10,
        receivedMessages: scenario === 'fan-out' ? 20 : 10,
        lostMessages: 0,
        duplicateMessages: 0,
        errorCount: 0,
      });
      expect(metrics.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(metrics.throughputMessagesPerSecond).toBeGreaterThan(0);
      expect(metrics.ordering.nativeScopeViolations).toBe(0);
      expect(metrics.backlog.finalObservedMessages).toBe(0);
    },
    45_000,
  );

  it.each(adapters)(
    '$name observes slow-consumer latency and drains backlog',
    async ({ adapter, name }) => {
      const metrics = await executeBenchmark(
        adapter,
        name,
        'competing-consumers',
        5,
      );

      expect(metrics.latency.p50Ms).toBeGreaterThanOrEqual(5);
      expect(metrics.backlog.maximumObservedMessages).toBeGreaterThan(0);
      expect(metrics.backlog.finalObservedMessages).toBe(0);
      expect(metrics.lostMessages).toBe(0);
      expect(metrics.duplicateMessages).toBe(0);
      expect(metrics.ordering.nativeScopeViolations).toBe(0);
    },
    45_000,
  );
});

async function executeBenchmark(
  adapter: BrokerAdapter,
  broker: BrokerId,
  scenario: ScenarioId,
  consumerDelayMs = 0,
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('Integration benchmark timed out.')),
    30_000,
  );

  try {
    return await new BenchmarkEngine().execute({
      runId: randomUUID(),
      adapter,
      signal: controller.signal,
      configuration: {
        broker,
        scenario,
        ...BENCHMARK_DEFAULTS,
        messageCount: 10,
        payloadSizeBytes: 64,
        producerConcurrency: 2,
        consumerCount: 2,
        timeoutMs: 30_000,
        consumerDelayMs,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}
