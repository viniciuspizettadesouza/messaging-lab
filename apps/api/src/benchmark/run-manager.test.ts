import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BENCHMARK_DEFAULTS } from '@messaging-lab/shared';

import { ImmediateAdapter } from './fake-adapter.test-helper.js';
import { RunEventStore } from './run-events.js';
import { RunManager } from './run-manager.js';
import { openDatabase } from '../database.js';
import { ApiError } from '../errors.js';
import { RunRepository } from '../run-repository.js';

describe('RunManager', () => {
  let database: ReturnType<typeof openDatabase>;
  let repository: RunRepository;
  let events: RunEventStore;

  beforeEach(() => {
    database = openDatabase(':memory:');
    repository = new RunRepository(database);
    events = new RunEventStore();
  });

  afterEach(() => database.close());

  it('persists completed metrics, notes, and lifecycle events', async () => {
    const adapter = new ImmediateAdapter();
    const manager = new RunManager(
      repository,
      { redis: adapter, kafka: adapter, rabbitmq: adapter },
      events,
    );
    const run = manager.start({
      broker: 'redis',
      scenario: 'fan-out',
      ...BENCHMARK_DEFAULTS,
      messageCount: 2,
    });

    const completed = await waitForStatus(repository, run.id, 'completed');
    expect(completed.metrics).toMatchObject({ publishedMessages: 2 });
    expect(completed.notes).toEqual(
      expect.arrayContaining([
        'Redis Pub/Sub delivers only to subscribers that are connected.',
      ]),
    );
    expect(events.history(run.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'metrics' }),
        expect.objectContaining({ type: 'status', status: 'completed' }),
      ]),
    );
  });

  it('rejects concurrent runs and supports cancellation', async () => {
    const adapter = new NeverDeliverAdapter();
    const manager = new RunManager(
      repository,
      { redis: adapter, kafka: adapter, rabbitmq: adapter },
      events,
    );
    const run = manager.start({
      broker: 'redis',
      scenario: 'fan-out',
      ...BENCHMARK_DEFAULTS,
      timeoutMs: 1_000,
    });

    expect(() =>
      manager.start({
        broker: 'kafka',
        scenario: 'fan-out',
        ...BENCHMARK_DEFAULTS,
      }),
    ).toThrow(ApiError);
    await waitForStatus(repository, run.id, 'running');
    manager.cancel(run.id);

    const cancelled = await waitForStatus(repository, run.id, 'cancelled');
    expect(cancelled.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'RUN_CANCELLED' }),
      ]),
    );
    expect(adapter.cleaned).toBe(true);
  });

  it('times out stalled runs', async () => {
    const adapter = new NeverDeliverAdapter();
    const manager = new RunManager(
      repository,
      { redis: adapter, kafka: adapter, rabbitmq: adapter },
      events,
    );
    const run = manager.start({
      broker: 'redis',
      scenario: 'fan-out',
      ...BENCHMARK_DEFAULTS,
      timeoutMs: 1_000,
    });

    const timedOut = await waitForStatus(repository, run.id, 'timed-out');
    expect(timedOut.errors[0]).toMatchObject({ code: 'RUN_TIMED_OUT' });
    expect(adapter.cleaned).toBe(true);
  });

  it('records execution and cleanup failures', async () => {
    const adapter = new CleanupFailureAdapter();
    const manager = new RunManager(
      repository,
      { redis: adapter, kafka: adapter, rabbitmq: adapter },
      events,
    );
    const run = manager.start({
      broker: 'redis',
      scenario: 'competing-consumers',
      ...BENCHMARK_DEFAULTS,
      messageCount: 1,
    });

    const failed = await waitForStatus(repository, run.id, 'failed');
    expect(failed.metrics).toMatchObject({ publishedMessages: 1 });
    expect(failed.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'RUN_FAILED' }),
        expect.objectContaining({ code: 'CLEANUP_FAILED' }),
      ]),
    );
  });
});

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

class CleanupFailureAdapter extends ImmediateAdapter {
  public override async createRun(
    context: Parameters<ImmediateAdapter['createRun']>[0],
  ) {
    const resource = await super.createRun(context);
    return {
      ...resource,
      cleanup: async () => ({
        attemptedResources: 1,
        removedResources: 0,
        failures: [{ resource: 'fake-resource', message: 'Cleanup failed.' }],
      }),
    };
  }
}

async function waitForStatus(
  repository: RunRepository,
  runId: string,
  status: string,
) {
  const deadline = Date.now() + 3_000;

  while (Date.now() < deadline) {
    const run = repository.requireById(runId);
    if (run.status === status) return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(`Timed out waiting for run status ${status}.`);
}
