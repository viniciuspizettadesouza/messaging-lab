import { describe, expect, it } from 'vitest';

import {
  benchmarkMetricsSchema,
  brokerIdSchema,
  capabilityFlagSchema,
  runStatusSchema,
  scenarioIdSchema,
} from './domain.js';

const validMetrics = {
  elapsedMs: 100,
  throughputMessagesPerSecond: 1_000,
  latency: { p50Ms: 1, p95Ms: 2, p99Ms: 3 },
  publishedMessages: 100,
  receivedMessages: 100,
  lostMessages: 0,
  duplicateMessages: 0,
  errorCount: 0,
};

describe('domain identifier schemas', () => {
  it('accepts public identifiers', () => {
    expect(brokerIdSchema.parse('kafka')).toBe('kafka');
    expect(scenarioIdSchema.parse('competing-consumers')).toBe(
      'competing-consumers',
    );
    expect(runStatusSchema.parse('timed-out')).toBe('timed-out');
    expect(capabilityFlagSchema.parse('consumerRecovery')).toBe(
      'consumerRecovery',
    );
  });

  it('rejects identifiers outside the contract', () => {
    expect(brokerIdSchema.safeParse('nats').success).toBe(false);
    expect(scenarioIdSchema.safeParse('replay').success).toBe(false);
    expect(runStatusSchema.safeParse('stopped').success).toBe(false);
  });
});

describe('benchmarkMetricsSchema', () => {
  it('accepts finite, non-negative aggregate metrics', () => {
    expect(benchmarkMetricsSchema.parse(validMetrics)).toEqual(validMetrics);
  });

  it('rejects negative and non-finite metrics', () => {
    expect(
      benchmarkMetricsSchema.safeParse({ ...validMetrics, elapsedMs: -1 })
        .success,
    ).toBe(false);
    expect(
      benchmarkMetricsSchema.safeParse({
        ...validMetrics,
        throughputMessagesPerSecond: Number.POSITIVE_INFINITY,
      }).success,
    ).toBe(false);
  });

  it('requires ordered latency percentiles', () => {
    expect(
      benchmarkMetricsSchema.safeParse({
        ...validMetrics,
        latency: { p50Ms: 5, p95Ms: 2, p99Ms: 3 },
      }).success,
    ).toBe(false);
  });
});
