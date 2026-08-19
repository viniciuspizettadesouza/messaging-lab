import { describe, expect, it } from 'vitest';

import {
  BENCHMARK_DEFAULTS,
  type Run,
  type RunStatus,
  type SuiteRun,
} from '@messaging-lab/shared';

import {
  summarizeDistribution,
  summarizeSuiteCombinations,
} from './suite-statistics.js';

const combination = { broker: 'kafka', scenario: 'fan-out' } as const;

describe('suite statistics', () => {
  it('calculates median, extrema, quartiles, and IQR without mutating samples', () => {
    const samples = [100, 2, 3, 4, 1];
    expect(summarizeDistribution(samples)).toEqual({
      sampleSize: 5,
      minimum: 1,
      q1: 2,
      median: 3,
      q3: 4,
      maximum: 100,
      interquartileRange: 2,
    });
    expect(samples).toEqual([100, 2, 3, 4, 1]);
  });

  it('returns no distribution for an empty sample', () => {
    expect(summarizeDistribution([])).toBeNull();
  });

  it('keeps partial failures in counts while excluding them from distributions', () => {
    const trials = [
      trial(0, 'completed', 100, { lost: 2, duplicates: 1, errors: 3 }),
      trial(1, 'failed'),
      trial(2, 'timed-out'),
      trial(3, 'cancelled'),
    ];
    const [summary] = summarizeSuiteCombinations([combination], trials);

    expect(summary).toMatchObject({
      totalTrials: 4,
      successfulTrials: 1,
      unsuccessfulTrials: 3,
      statusCounts: { completed: 1, failed: 1, timedOut: 1, cancelled: 1 },
      throughput: { sampleSize: 1, median: 100 },
      totals: {
        lostMessages: 2,
        duplicateMessages: 1,
        redeliveredMessages: 0,
        errors: 4,
      },
    });
  });
});

function trial(
  position: number,
  status: RunStatus,
  throughput?: number,
  anomalies = { lost: 0, duplicates: 0, errors: 0 },
): SuiteRun {
  const timestamp = '2026-08-19T12:00:00.000Z';
  const run: Run = {
    id: `11111111-1111-4111-8111-${String(position + 1).padStart(12, '0')}`,
    name: null,
    description: null,
    configuration: { ...BENCHMARK_DEFAULTS, ...combination },
    status,
    createdAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
    metrics:
      status === 'completed' && throughput !== undefined
        ? {
            elapsedMs: 10,
            throughputMessagesPerSecond: throughput,
            latency: { p50Ms: 1, p95Ms: 2, p99Ms: 3 },
            publishedMessages: 10,
            receivedMessages: 8,
            lostMessages: anomalies.lost,
            duplicateMessages: anomalies.duplicates,
            errorCount: anomalies.errors,
          }
        : null,
    notes: [],
    errors:
      status === 'failed'
        ? [{ code: 'FAILED', message: 'failed', occurredAt: timestamp }]
        : [],
  };
  return {
    position,
    combinationIndex: 0,
    repetition: position + 1,
    combination,
    run,
  };
}
