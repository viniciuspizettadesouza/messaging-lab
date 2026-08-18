import { describe, expect, it } from 'vitest';

import {
  BENCHMARK_DEFAULTS,
  type RunConfiguration,
} from '@messaging-lab/shared';

import { BenchmarkEngine } from './benchmark-engine.js';
import { ImmediateAdapter } from './fake-adapter.test-helper.js';

describe('BenchmarkEngine', () => {
  it('measures fan-out delivery semantics and cleans up resources', async () => {
    const adapter = new ImmediateAdapter();
    const configuration: RunConfiguration = {
      broker: 'redis',
      scenario: 'fan-out',
      ...BENCHMARK_DEFAULTS,
      messageCount: 3,
      payloadSizeBytes: 8,
      consumerCount: 2,
    };

    const metrics = await new BenchmarkEngine().execute({
      runId: 'run-1',
      configuration,
      adapter,
      signal: new AbortController().signal,
    });

    expect(metrics).toMatchObject({
      publishedMessages: 3,
      receivedMessages: 6,
      lostMessages: 0,
      duplicateMessages: 0,
      errorCount: 0,
    });
    expect(metrics.latency.p99Ms).toBeGreaterThanOrEqual(metrics.latency.p50Ms);
    expect(adapter.publishedPayloadSizes).toEqual([8, 8, 8, 8]);
    expect(adapter.cleaned).toBe(true);
  });

  it('counts duplicate deliveries for competing consumers', async () => {
    const adapter = new ImmediateAdapter(true);
    const metrics = await new BenchmarkEngine().execute({
      runId: 'run-2',
      configuration: {
        broker: 'redis',
        scenario: 'competing-consumers',
        ...BENCHMARK_DEFAULTS,
        messageCount: 3,
      },
      adapter,
      signal: new AbortController().signal,
    });

    expect(metrics).toMatchObject({
      publishedMessages: 3,
      receivedMessages: 6,
      lostMessages: 0,
      duplicateMessages: 3,
    });
  });
});
