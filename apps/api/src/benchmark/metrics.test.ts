import { describe, expect, it } from 'vitest';

import { createMetrics, LatencySampler } from './metrics.js';
import { createDeterministicPayload, warmupMessageCount } from './payload.js';

describe('LatencySampler', () => {
  it('calculates nearest-rank percentiles', () => {
    const sampler = new LatencySampler();
    for (const value of [1, 2, 3, 4, 100]) sampler.add(value);

    expect(sampler.percentiles()).toEqual({ p50Ms: 3, p95Ms: 100, p99Ms: 100 });
  });

  it('keeps a bounded reservoir sample', () => {
    const sampler = new LatencySampler(2, () => 0);
    for (const value of [1, 2, 3, 4]) sampler.add(value);

    expect(sampler.size).toBe(2);
    expect(sampler.percentiles()).toEqual({ p50Ms: 2, p95Ms: 4, p99Ms: 4 });
  });
});

describe('createMetrics', () => {
  it('calculates throughput, loss, duplicates, and counts', () => {
    expect(
      createMetrics({
        elapsedMs: 2_000,
        messageCount: 1_000,
        expectedDeliveries: 1_000,
        receivedDeliveries: 997,
        uniqueDeliveries: 995,
        duplicateDeliveries: 2,
        latency: { p50Ms: 1, p95Ms: 2, p99Ms: 3 },
      }),
    ).toEqual({
      elapsedMs: 2_000,
      throughputMessagesPerSecond: 500,
      latency: { p50Ms: 1, p95Ms: 2, p99Ms: 3 },
      publishedMessages: 1_000,
      receivedMessages: 997,
      lostMessages: 5,
      duplicateMessages: 2,
      errorCount: 0,
    });
  });
});

describe('benchmark payload helpers', () => {
  it('creates exact-size deterministic payloads', () => {
    expect(createDeterministicPayload(4, 2)).toEqual(
      Uint8Array.from([2, 3, 4, 5]),
    );
    expect(createDeterministicPayload(4, 2)).toEqual(
      createDeterministicPayload(4, 2),
    );
  });

  it('bounds warm-up messages', () => {
    expect(warmupMessageCount(1)).toBe(1);
    expect(warmupMessageCount(10_000)).toBe(100);
    expect(warmupMessageCount(1_000_000)).toBe(100);
  });
});
