import type {
  BenchmarkMetrics,
  BrokerAdapter,
  BrokerDelivery,
  BrokerRunResource,
  CleanupReport,
  RunConfiguration,
  RunPhase,
} from '@messaging-lab/shared';

import { createMetrics, LatencySampler } from './metrics.js';
import { createDeterministicPayload, warmupMessageCount } from './payload.js';

export interface BenchmarkProgress {
  readonly phase: RunPhase;
  readonly completedUnits: number;
  readonly totalUnits: number;
  readonly publishedMessages: number;
  readonly receivedMessages: number;
}

export interface BenchmarkExecutionOptions {
  readonly runId: string;
  readonly configuration: RunConfiguration;
  readonly adapter: BrokerAdapter;
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: BenchmarkProgress) => void;
}

export class BenchmarkExecutionError extends Error {
  public constructor(
    public readonly cause: unknown,
    public readonly cleanupReport: CleanupReport,
    public readonly metrics?: BenchmarkMetrics,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'BenchmarkExecutionError';
  }
}

export class BenchmarkEngine {
  public constructor(private readonly latencySampleCapacity = 10_000) {}

  public async execute(
    options: BenchmarkExecutionOptions,
  ): Promise<BenchmarkMetrics> {
    const { configuration, signal } = options;
    const expectedMultiplier =
      configuration.scenario === 'fan-out' ? configuration.consumerCount : 1;
    const warmupMessages = warmupMessageCount(configuration.messageCount);
    const tracker = new DeliveryTracker(
      warmupMessages * expectedMultiplier,
      configuration.messageCount * expectedMultiplier,
      configuration.scenario === 'fan-out',
      expectedMultiplier,
      this.latencySampleCapacity,
      options.onProgress,
    );
    let resource: BrokerRunResource | undefined;
    let creation: Promise<BrokerRunResource> | undefined;
    let executionError: unknown;
    let metrics: BenchmarkMetrics | undefined;

    try {
      throwIfAborted(signal);
      options.onProgress?.({
        phase: 'preparing',
        completedUnits: 0,
        totalUnits: 1,
        publishedMessages: 0,
        receivedMessages: 0,
      });
      creation = options.adapter.createRun({
        runId: options.runId,
        scenario: configuration.scenario,
        consumerCount: configuration.consumerCount,
        signal,
      });
      resource = await raceWithSignal(creation, signal);
      await raceWithSignal(
        resource.startConsumers(async (delivery) => {
          if (
            configuration.consumerDelayMs > 0 &&
            delivery.id.startsWith('message-')
          ) {
            await delay(configuration.consumerDelayMs, signal);
          }
          tracker.add(delivery);
        }),
        signal,
      );
      options.onProgress?.({
        phase: 'preparing',
        completedUnits: 1,
        totalUnits: 1,
        publishedMessages: 0,
        receivedMessages: 0,
      });

      options.onProgress?.({
        phase: 'warming-up',
        completedUnits: 0,
        totalUnits: warmupMessages,
        publishedMessages: 0,
        receivedMessages: 0,
      });
      for (let index = 0; index < warmupMessages; index += 1) {
        throwIfAborted(signal);
        await raceWithSignal(
          resource.publish({
            id: `warmup-${index}`,
            globalSequence: index,
            producerId: 'warmup-producer',
            producerSequence: index,
            orderingKey: 'warmup',
            payload: createDeterministicPayload(
              configuration.payloadSizeBytes,
              index,
            ),
            publishedAtNanoseconds: process.hrtime.bigint(),
          }),
          signal,
        );
        options.onProgress?.({
          phase: 'warming-up',
          completedUnits: index + 1,
          totalUnits: warmupMessages,
          publishedMessages: 0,
          receivedMessages: 0,
        });
      }
      await tracker.waitForWarmup(signal);

      tracker.startMeasurement();
      const startedAt = process.hrtime.bigint();
      let nextMessage = 0;
      let publishedMessages = 0;
      let submittedMessages = 0;
      const workers = Array.from(
        { length: configuration.producerConcurrency },
        async (_, producerIndex) => {
          const producerId = `producer-${producerIndex + 1}`;
          let producerSequence = 0;
          while (true) {
            const index = nextMessage;
            nextMessage += 1;
            if (index >= configuration.messageCount) return;
            throwIfAborted(signal);
            submittedMessages += 1;
            tracker.setSubmittedMessages(submittedMessages);
            await raceWithSignal(
              resource!.publish({
                id: `message-${index}`,
                globalSequence: index,
                producerId,
                producerSequence,
                orderingKey: producerId,
                payload: createDeterministicPayload(
                  configuration.payloadSizeBytes,
                  index,
                ),
                publishedAtNanoseconds: process.hrtime.bigint(),
              }),
              signal,
            );
            producerSequence += 1;
            publishedMessages += 1;
            options.onProgress?.({
              phase: 'publishing',
              completedUnits: publishedMessages,
              totalUnits: configuration.messageCount,
              publishedMessages,
              receivedMessages: tracker.receivedDeliveries,
            });
          }
        },
      );
      await Promise.all(workers);
      options.onProgress?.({
        phase: 'consuming',
        completedUnits: tracker.uniqueDeliveries,
        totalUnits: tracker.expectedDeliveries,
        publishedMessages,
        receivedMessages: tracker.receivedDeliveries,
      });
      await tracker.waitForMeasurement(signal);
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      metrics = createMetrics({
        elapsedMs,
        messageCount: configuration.messageCount,
        expectedDeliveries: tracker.expectedDeliveries,
        receivedDeliveries: tracker.receivedDeliveries,
        uniqueDeliveries: tracker.uniqueDeliveries,
        duplicateDeliveries: tracker.duplicateDeliveries,
        latency: tracker.latency,
        globalOrderingViolations: tracker.globalOrderingViolations,
        nativeScopeOrderingViolations: tracker.nativeScopeOrderingViolations,
        maximumObservedBacklog: tracker.maximumObservedBacklog,
        finalObservedBacklog: tracker.currentObservedBacklog,
      });
    } catch (error) {
      executionError = error;
    } finally {
      options.onProgress?.({
        phase: 'cleaning-up',
        completedUnits: 0,
        totalUnits: 1,
        publishedMessages: metrics?.publishedMessages ?? 0,
        receivedMessages:
          metrics?.receivedMessages ?? tracker.receivedDeliveries,
      });
    }

    if (!resource && creation) {
      void creation
        .then((lateResource) => lateResource.cleanup())
        .catch(() => undefined);
    }

    const cleanupReport = resource
      ? await resource.cleanup()
      : { attemptedResources: 0, removedResources: 0, failures: [] };
    options.onProgress?.({
      phase: 'cleaning-up',
      completedUnits: 1,
      totalUnits: 1,
      publishedMessages: metrics?.publishedMessages ?? 0,
      receivedMessages: metrics?.receivedMessages ?? tracker.receivedDeliveries,
    });

    if (executionError || cleanupReport.failures.length > 0) {
      throw new BenchmarkExecutionError(
        executionError ?? new Error('Broker resource cleanup failed.'),
        cleanupReport,
        metrics,
      );
    }

    if (!metrics) throw new Error('Benchmark completed without metrics.');
    return metrics;
  }
}

class DeliveryTracker {
  private readonly warmupKeys = new Set<string>();
  private readonly deliveryKeys = new Set<string>();
  private readonly sampler: LatencySampler;
  private readonly warmupComplete: Promise<void>;
  private readonly measurementComplete: Promise<void>;
  private resolveWarmup!: () => void;
  private resolveMeasurement!: () => void;
  private measuring = false;
  private received = 0;
  private duplicates = 0;
  private submitted = 0;
  private globalViolations = 0;
  private nativeViolations = 0;
  private maximumBacklog = 0;
  private readonly lastGlobalSequence = new Map<string, number>();
  private readonly lastNativeSequence = new Map<string, number>();

  public constructor(
    private readonly expectedWarmupDeliveries: number,
    public readonly expectedDeliveries: number,
    private readonly fanOut: boolean,
    private readonly deliveryMultiplier: number,
    sampleCapacity: number,
    private readonly onProgress?: (progress: BenchmarkProgress) => void,
  ) {
    this.sampler = new LatencySampler(sampleCapacity);
    this.warmupComplete = new Promise((resolve) => {
      this.resolveWarmup = resolve;
    });
    this.measurementComplete = new Promise((resolve) => {
      this.resolveMeasurement = resolve;
    });
  }

  public add(delivery: BrokerDelivery): void {
    const key = this.fanOut
      ? `${delivery.id}:${delivery.consumerId}`
      : delivery.id;

    if (!this.measuring) {
      if (!delivery.id.startsWith('warmup-')) return;
      this.warmupKeys.add(key);
      if (this.warmupKeys.size >= this.expectedWarmupDeliveries) {
        this.resolveWarmup();
      }
      return;
    }

    if (!delivery.id.startsWith('message-')) return;
    this.received += 1;
    if (this.deliveryKeys.has(key)) this.duplicates += 1;
    else {
      this.deliveryKeys.add(key);
      this.observeOrdering(delivery);
    }
    const latencyMs =
      Number(process.hrtime.bigint() - delivery.publishedAtNanoseconds) /
      1_000_000;
    this.sampler.add(latencyMs);
    this.onProgress?.({
      phase: 'consuming',
      completedUnits: this.deliveryKeys.size,
      totalUnits: this.expectedDeliveries,
      publishedMessages: this.submitted,
      receivedMessages: this.received,
    });

    if (this.deliveryKeys.size >= this.expectedDeliveries) {
      this.resolveMeasurement();
    }
  }

  public startMeasurement(): void {
    this.measuring = true;
  }

  public setSubmittedMessages(submittedMessages: number): void {
    this.submitted = submittedMessages;
    this.maximumBacklog = Math.max(
      this.maximumBacklog,
      this.currentObservedBacklog,
    );
  }

  public async waitForWarmup(signal: AbortSignal): Promise<void> {
    await raceWithSignal(this.warmupComplete, signal);
  }

  public async waitForMeasurement(signal: AbortSignal): Promise<void> {
    await raceWithSignal(this.measurementComplete, signal);
  }

  public get receivedDeliveries(): number {
    return this.received;
  }

  public get uniqueDeliveries(): number {
    return this.deliveryKeys.size;
  }

  public get duplicateDeliveries(): number {
    return this.duplicates;
  }

  public get latency(): BenchmarkMetrics['latency'] {
    return this.sampler.percentiles();
  }

  public get globalOrderingViolations(): number {
    return this.globalViolations;
  }

  public get nativeScopeOrderingViolations(): number {
    return this.nativeViolations;
  }

  public get maximumObservedBacklog(): number {
    return this.maximumBacklog;
  }

  public get currentObservedBacklog(): number {
    const expectedPublishedDeliveries = Math.min(
      this.expectedDeliveries,
      this.submitted * this.deliveryMultiplier,
    );
    return Math.max(0, expectedPublishedDeliveries - this.deliveryKeys.size);
  }

  private observeOrdering(delivery: BrokerDelivery): void {
    const globalScope = this.fanOut ? delivery.consumerId : 'all-consumers';
    const previousGlobal = this.lastGlobalSequence.get(globalScope);
    if (
      previousGlobal !== undefined &&
      delivery.globalSequence < previousGlobal
    ) {
      this.globalViolations += 1;
    }
    this.lastGlobalSequence.set(
      globalScope,
      Math.max(previousGlobal ?? -1, delivery.globalSequence),
    );

    if (delivery.nativeOrderScope === null) return;
    const nativeKey = `${delivery.nativeOrderScope}:${delivery.producerId}:${delivery.orderingKey}`;
    const previousNative = this.lastNativeSequence.get(nativeKey);
    if (
      previousNative !== undefined &&
      delivery.producerSequence < previousNative
    ) {
      this.nativeViolations += 1;
    }
    this.lastNativeSequence.set(
      nativeKey,
      Math.max(previousNative ?? -1, delivery.producerSequence),
    );
  }
}

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason ?? new Error('Benchmark aborted.');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('Benchmark aborted.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error('Benchmark aborted.');
}

function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);

  return new Promise((resolve, reject) => {
    const onAbort = () =>
      reject(signal.reason ?? new Error('Benchmark aborted.'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
