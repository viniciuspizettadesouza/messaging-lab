import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BENCHMARK_DEFAULTS,
  type DeliveryHandler,
  type ResolvedCreateSuiteRequest,
  type SuiteConfiguration,
} from '@messaging-lab/shared';

import { openDatabase } from '../database.js';
import { ApiError } from '../errors.js';
import { RunRepository } from '../run-repository.js';
import { SuiteRepository } from '../suite-repository.js';
import { ImmediateAdapter } from './fake-adapter.test-helper.js';
import { RunEventStore } from './run-events.js';
import { RunManager } from './run-manager.js';
import { SuiteEventStore } from './suite-events.js';
import { buildSuiteExecutionOrder, SuiteScheduler } from './suite-scheduler.js';
import { testEnvironmentSnapshot } from '../test-environment.test-helper.js';

const configuration: SuiteConfiguration = {
  workload: { ...BENCHMARK_DEFAULTS, messageCount: 1 },
  combinations: [
    { broker: 'redis', scenario: 'competing-consumers' },
    { broker: 'kafka', scenario: 'fan-out' },
    { broker: 'rabbitmq', scenario: 'competing-consumers' },
  ],
  repetitions: 2,
  orderStrategy: 'fixed',
  cooldownMs: 0,
};

describe('buildSuiteExecutionOrder', () => {
  it('builds fixed and rotating orders with stable indexes', () => {
    const fixed = buildSuiteExecutionOrder(configuration);
    expect(fixed.map(({ combinationIndex }) => combinationIndex)).toEqual([
      0, 1, 2, 0, 1, 2,
    ]);

    const rotating = buildSuiteExecutionOrder({
      ...configuration,
      orderStrategy: 'rotating',
    });
    expect(rotating.map(({ combinationIndex }) => combinationIndex)).toEqual([
      0, 1, 2, 1, 2, 0,
    ]);
  });

  it('uses the supplied random source and persists sequential positions', () => {
    const randomized = buildSuiteExecutionOrder(
      { ...configuration, orderStrategy: 'randomized' },
      () => 0,
    );
    expect(randomized.map(({ combinationIndex }) => combinationIndex)).toEqual([
      1, 2, 0, 1, 2, 0,
    ]);
    expect(randomized.map(({ position }) => position)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });
});

describe('SuiteScheduler', () => {
  let database: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    database = openDatabase(':memory:');
  });

  afterEach(() => database.close());

  it('runs serially, continues after a failed trial, and emits transitions', async () => {
    const adapter = new FailFirstAdapter();
    const { scheduler, suites, suiteEvents } = createScheduler(
      database,
      adapter,
    );
    const suite = scheduler.start(
      request({
        ...configuration,
        combinations: configuration.combinations.slice(0, 2),
        repetitions: 1,
      }),
    );

    const completed = await scheduler.waitForCompletion(suite.id);
    expect(completed).toMatchObject({
      status: 'completed',
      summary: { failedRuns: 1, completedRuns: 1 },
    });
    expect(completed.runs.every(({ run }) => run !== null)).toBe(true);
    expect(adapter.maximumActiveResources).toBe(1);
    expect(suites.requireById(suite.id).runs).toHaveLength(2);
    expect(suiteEvents.history(suite.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'status', status: 'running' }),
        expect.objectContaining({ type: 'run-event' }),
        expect.objectContaining({ type: 'status', status: 'completed' }),
      ]),
    );
  });

  it('aborts cooldown and leaves queued work unstarted when cancelled', async () => {
    const adapter = new ImmediateAdapter();
    let cooldownStarted = false;
    const delay = (_milliseconds: number, signal: AbortSignal) =>
      new Promise<void>((_resolve, reject) => {
        cooldownStarted = true;
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
    const { scheduler } = createScheduler(database, adapter, delay);
    const suite = scheduler.start(
      request({
        ...configuration,
        combinations: configuration.combinations.slice(0, 2),
        repetitions: 1,
        cooldownMs: 1_000,
      }),
    );
    await waitFor(() => cooldownStarted);
    scheduler.cancel(suite.id);

    const cancelled = await scheduler.waitForCompletion(suite.id);
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      summary: { completedRuns: 1, pendingRuns: 1 },
    });
    expect(cancelled.runs.filter(({ run }) => run !== null)).toHaveLength(1);
  });

  it('cancels the active trial and rejects a second active suite', async () => {
    const adapter = new NeverDeliverAdapter();
    const { scheduler, runs } = createScheduler(database, adapter);
    const suite = scheduler.start(
      request({
        ...configuration,
        combinations: configuration.combinations.slice(0, 1),
        repetitions: 1,
      }),
    );
    expect(() => scheduler.start(request(configuration))).toThrow(ApiError);
    await waitFor(
      () => runs.list({ limit: 20, offset: 0 }).runs[0]?.status === 'running',
    );
    scheduler.cancel(suite.id);

    const cancelled = await scheduler.waitForCompletion(suite.id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.runs[0]?.run?.status).toBe('cancelled');
    expect(adapter.cleaned).toBe(true);
  });
});

function request(
  suiteConfiguration: SuiteConfiguration,
): ResolvedCreateSuiteRequest {
  return {
    name: 'Scheduler suite',
    description: null,
    configuration: suiteConfiguration,
  };
}

function createScheduler(
  database: ReturnType<typeof openDatabase>,
  adapter: ImmediateAdapter,
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>,
) {
  const runs = new RunRepository(database);
  const runEvents = new RunEventStore();
  const runManager = new RunManager(
    runs,
    { redis: adapter, kafka: adapter, rabbitmq: adapter },
    runEvents,
  );
  const suites = new SuiteRepository(database, runs);
  const suiteEvents = new SuiteEventStore();
  const scheduler = new SuiteScheduler(
    suites,
    runManager,
    runEvents,
    suiteEvents,
    () => testEnvironmentSnapshot,
    Math.random,
    delay,
  );
  return { scheduler, suites, runs, suiteEvents };
}

class FailFirstAdapter extends ImmediateAdapter {
  private createdResources = 0;
  private activeResources = 0;
  public maximumActiveResources = 0;

  public override async createRun(
    context: Parameters<ImmediateAdapter['createRun']>[0],
  ) {
    const resource = await super.createRun(context);
    const shouldFail = this.createdResources++ === 0;
    this.activeResources += 1;
    this.maximumActiveResources = Math.max(
      this.maximumActiveResources,
      this.activeResources,
    );
    return {
      ...resource,
      startConsumers: async (onDelivery: DeliveryHandler) => {
        if (shouldFail) throw new Error('First trial failed.');
        return resource.startConsumers(onDelivery);
      },
      cleanup: async () => {
        this.activeResources -= 1;
        return resource.cleanup();
      },
    };
  }
}

class NeverDeliverAdapter extends ImmediateAdapter {
  public override async createRun() {
    return {
      resourceNames: ['never-deliver'],
      startConsumers: async () => undefined,
      publish: async () => undefined,
      cleanup: async () => {
        this.cleaned = true;
        return { attemptedResources: 1, removedResources: 1, failures: [] };
      },
    };
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for scheduler state.');
}
