import { describe, expect, it } from 'vitest';

import {
  BROKER_CAPABILITIES,
  BENCHMARK_DEFAULTS,
  type BrokerAdapter,
  type BrokerRunResource,
  type DeliveryHandler,
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

  it('measures global and broker-native ordering violations separately', async () => {
    const adapter = new ImmediateAdapter(false, (message) =>
      message.id === 'message-0' ? 20 : 0,
    );
    const metrics = await new BenchmarkEngine().execute({
      runId: 'run-ordering',
      configuration: {
        broker: 'redis',
        scenario: 'competing-consumers',
        ...BENCHMARK_DEFAULTS,
        messageCount: 4,
        producerConcurrency: 2,
      },
      adapter,
      signal: new AbortController().signal,
    });

    expect(metrics.ordering.globalViolations).toBeGreaterThan(0);
    expect(metrics.ordering.nativeScopeViolations).toBe(0);
  });

  it('includes artificial consumer delay and observed backlog', async () => {
    const metrics = await new BenchmarkEngine().execute({
      runId: 'run-backpressure',
      configuration: {
        broker: 'redis',
        scenario: 'competing-consumers',
        ...BENCHMARK_DEFAULTS,
        messageCount: 3,
        consumerDelayMs: 5,
      },
      adapter: new ImmediateAdapter(),
      signal: new AbortController().signal,
    });

    expect(metrics.elapsedMs).toBeGreaterThanOrEqual(15);
    expect(metrics.backlog.maximumObservedMessages).toBeGreaterThan(0);
    expect(metrics.backlog.finalObservedMessages).toBe(0);
  });

  it('detects ordering regressions inside one native scope', async () => {
    const metrics = await new BenchmarkEngine().execute({
      runId: 'run-native-ordering',
      configuration: {
        broker: 'redis',
        scenario: 'competing-consumers',
        ...BENCHMARK_DEFAULTS,
        messageCount: 4,
      },
      adapter: new AsyncReorderingAdapter(),
      signal: new AbortController().signal,
    });

    expect(metrics.ordering.globalViolations).toBeGreaterThan(0);
    expect(metrics.ordering.nativeScopeViolations).toBeGreaterThan(0);
  });
});

class AsyncReorderingAdapter implements BrokerAdapter {
  public readonly id = 'redis' as const;
  public readonly capabilities = BROKER_CAPABILITIES.redis;

  public async checkHealth() {
    return {
      status: 'healthy' as const,
      latencyMs: 0,
      checkedAt: new Date().toISOString(),
      error: null,
    };
  }

  public async createRun(): Promise<BrokerRunResource> {
    let handler: DeliveryHandler | undefined;
    return {
      resourceNames: ['async-fake'],
      startConsumers: async (onDelivery: DeliveryHandler) => {
        handler = onDelivery;
      },
      publish: async (message) => {
        const delayMs = message.id === 'message-0' ? 20 : 0;
        setTimeout(() => {
          if (!handler) return;
          void handler({
            ...message,
            consumerId: 'consumer-1',
            nativeOrderScope: 'fake:scope',
          });
        }, delayMs);
      },
      cleanup: async () => ({
        attemptedResources: 1,
        removedResources: 1,
        failures: [],
      }),
    };
  }
}
