import { describe, expect, it } from 'vitest';

import {
  cancelRunResponseSchema,
  runEventSchema,
  runSchema,
  runsQuerySchema,
  suiteEventSchema,
  suiteProgressSchema,
  suiteSchema,
  suiteSummarySchema,
} from './api.js';
import { BENCHMARK_DEFAULTS } from './configuration.js';

const runId = '11111111-1111-4111-8111-111111111111';
const timestamp = '2026-08-18T12:00:00.000Z';

describe('API schemas', () => {
  it('validates a complete run response', () => {
    const result = runSchema.safeParse({
      id: runId,
      configuration: {
        broker: 'redis',
        scenario: 'fan-out',
        ...BENCHMARK_DEFAULTS,
      },
      status: 'pending',
      createdAt: timestamp,
      startedAt: null,
      finishedAt: null,
      metrics: null,
      notes: [],
      errors: [],
    });

    expect(result.success).toBe(true);
  });

  it('coerces and bounds run-history pagination', () => {
    expect(runsQuerySchema.parse({ limit: '50', offset: '10' })).toEqual({
      limit: 50,
      offset: 10,
    });
    expect(runsQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('validates cancellation responses', () => {
    expect(
      cancelRunResponseSchema.parse({
        runId,
        cancellationRequested: true,
      }),
    ).toEqual({ runId, cancellationRequested: true });
  });
});

describe('suite schemas', () => {
  const suiteId = '22222222-2222-4222-8222-222222222222';
  const progress = {
    completedRuns: 1,
    totalRuns: 2,
    currentPosition: 1,
    currentCombination: { broker: 'kafka', scenario: 'fan-out' },
    currentRepetition: 1,
    activeRunId: runId,
  } as const;
  const summary = {
    totalRuns: 2,
    pendingRuns: 0,
    runningRuns: 1,
    completedRuns: 1,
    failedRuns: 0,
    timedOutRuns: 0,
    cancelledRuns: 0,
  };

  it('validates suite state, configuration, progress, and summary', () => {
    expect(
      suiteSchema.safeParse({
        id: suiteId,
        name: 'Durable comparison',
        status: 'running',
        configuration: {
          workload: BENCHMARK_DEFAULTS,
          combinations: [
            { broker: 'redis', scenario: 'competing-consumers' },
            { broker: 'kafka', scenario: 'fan-out' },
          ],
          repetitions: 1,
          orderStrategy: 'fixed',
          cooldownMs: 0,
        },
        progress,
        summary,
        combinationSummaries: [],
        createdAt: timestamp,
        startedAt: timestamp,
        finishedAt: null,
        stopReason: null,
        errors: [],
        runs: [],
      }).success,
    ).toBe(true);
  });

  it('rejects inconsistent progress and summary counts', () => {
    expect(
      suiteProgressSchema.safeParse({ ...progress, completedRuns: 3 }).success,
    ).toBe(false);
    expect(
      suiteSummarySchema.safeParse({ ...summary, pendingRuns: 1 }).success,
    ).toBe(false);
  });

  it.each([
    { type: 'status', status: 'running' },
    { type: 'progress', progress },
    { type: 'summary', summary },
    { type: 'heartbeat' },
  ])('accepts the suite $type event variant', (event) => {
    expect(
      suiteEventSchema.safeParse({
        suiteId,
        sequence: 1,
        timestamp,
        ...event,
      }).success,
    ).toBe(true);
  });
});

describe('runEventSchema', () => {
  const baseEvent = { runId, sequence: 0, timestamp };

  it.each([
    { ...baseEvent, type: 'status', status: 'running' },
    {
      ...baseEvent,
      type: 'progress',
      phase: 'publishing',
      completedUnits: 10,
      totalUnits: 100,
      publishedMessages: 10,
      receivedMessages: 8,
    },
    { ...baseEvent, type: 'heartbeat' },
  ])('accepts the $type event variant', (event) => {
    expect(runEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejects data from a different event variant', () => {
    expect(
      runEventSchema.safeParse({
        ...baseEvent,
        type: 'status',
        status: 'running',
        phase: 'publishing',
      }).success,
    ).toBe(false);
  });
});
