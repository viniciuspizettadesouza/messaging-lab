import type { BenchmarkMetrics } from '@messaging-lab/shared';

export class LatencySampler {
  private readonly samples: number[] = [];
  private observedSamples = 0;

  public constructor(
    private readonly capacity = 10_000,
    private readonly random: () => number = Math.random,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('Latency sample capacity must be a positive integer.');
    }
  }

  public add(latencyMs: number): void {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
    this.observedSamples += 1;

    if (this.samples.length < this.capacity) {
      this.samples.push(latencyMs);
      return;
    }

    const replacementIndex = Math.floor(this.random() * this.observedSamples);
    if (replacementIndex < this.capacity) {
      this.samples[replacementIndex] = latencyMs;
    }
  }

  public percentiles(): BenchmarkMetrics['latency'] {
    const sorted = [...this.samples].sort((left, right) => left - right);
    return {
      p50Ms: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      p99Ms: percentile(sorted, 0.99),
    };
  }

  public get size(): number {
    return this.samples.length;
  }
}

export interface MetricInput {
  readonly elapsedMs: number;
  readonly messageCount: number;
  readonly expectedDeliveries: number;
  readonly receivedDeliveries: number;
  readonly uniqueDeliveries: number;
  readonly duplicateDeliveries: number;
  readonly latency: BenchmarkMetrics['latency'];
  readonly errorCount?: number;
  readonly globalOrderingViolations?: number;
  readonly nativeScopeOrderingViolations?: number;
  readonly maximumObservedBacklog?: number;
  readonly finalObservedBacklog?: number;
}

export function createMetrics(input: MetricInput): BenchmarkMetrics {
  return {
    elapsedMs: input.elapsedMs,
    throughputMessagesPerSecond:
      input.elapsedMs > 0 ? input.messageCount / (input.elapsedMs / 1_000) : 0,
    latency: input.latency,
    publishedMessages: input.messageCount,
    receivedMessages: input.receivedDeliveries,
    lostMessages: Math.max(
      0,
      input.expectedDeliveries - input.uniqueDeliveries,
    ),
    duplicateMessages: input.duplicateDeliveries,
    errorCount: input.errorCount ?? 0,
    ordering: {
      globalViolations: input.globalOrderingViolations ?? 0,
      nativeScopeViolations: input.nativeScopeOrderingViolations ?? 0,
    },
    backlog: {
      maximumObservedMessages: input.maximumObservedBacklog ?? 0,
      finalObservedMessages: input.finalObservedBacklog ?? 0,
    },
  };
}

function percentile(
  sortedValues: readonly number[],
  percentileValue: number,
): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.max(
    0,
    Math.ceil(percentileValue * sortedValues.length) - 1,
  );
  return sortedValues[index] ?? 0;
}
