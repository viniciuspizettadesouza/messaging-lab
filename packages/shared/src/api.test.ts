import { describe, expect, it } from 'vitest';

import {
  cancelRunResponseSchema,
  runEventSchema,
  runSchema,
  runsQuerySchema,
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
