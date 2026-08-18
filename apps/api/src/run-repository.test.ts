import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BENCHMARK_DEFAULTS,
  type RunConfiguration,
} from '@messaging-lab/shared';

import { openDatabase } from './database.js';
import { RunRepository } from './run-repository.js';

const configuration: RunConfiguration = {
  broker: 'redis',
  scenario: 'competing-consumers',
  ...BENCHMARK_DEFAULTS,
};

describe('RunRepository', () => {
  let database: ReturnType<typeof openDatabase>;
  let repository: RunRepository;
  let idCounter: number;

  beforeEach(() => {
    database = openDatabase(':memory:');
    idCounter = 1;
    repository = new RunRepository(
      database,
      () => new Date('2026-08-18T12:00:00.000Z'),
      () => `11111111-1111-4111-8111-${String(idCounter++).padStart(12, '0')}`,
    );
  });

  afterEach(() => database.close());

  it('creates, retrieves, and updates complete aggregate runs', () => {
    const created = repository.create(configuration);
    expect(created).toMatchObject({
      configuration,
      status: 'pending',
      metrics: null,
      notes: [],
      errors: [],
    });

    repository.updateStatus(created.id, 'running');
    repository.addNote(
      created.id,
      'Redis Streams retains acknowledged entries.',
    );
    repository.addError(created.id, {
      code: 'TRANSIENT_ERROR',
      message: 'A transient test error occurred.',
      occurredAt: '2026-08-18T12:00:00.000Z',
      details: { attempt: 1 },
    });
    repository.saveMetrics(created.id, {
      elapsedMs: 100,
      throughputMessagesPerSecond: 100_000,
      latency: { p50Ms: 0.5, p95Ms: 1, p99Ms: 2 },
      publishedMessages: 10_000,
      receivedMessages: 10_000,
      lostMessages: 0,
      duplicateMessages: 0,
      errorCount: 1,
    });
    const completed = repository.updateStatus(created.id, 'completed');

    expect(completed).toMatchObject({
      status: 'completed',
      startedAt: '2026-08-18T12:00:00.000Z',
      finishedAt: '2026-08-18T12:00:00.000Z',
      notes: ['Redis Streams retains acknowledged entries.'],
      errors: [{ code: 'TRANSIENT_ERROR', details: { attempt: 1 } }],
      metrics: { publishedMessages: 10_000, errorCount: 1 },
    });
  });

  it('lists runs with broker and status filters and pagination', () => {
    repository.create(configuration);
    const kafkaRun = repository.create({ ...configuration, broker: 'kafka' });
    repository.updateStatus(kafkaRun.id, 'failed');

    expect(
      repository.list({
        broker: 'kafka',
        status: 'failed',
        limit: 20,
        offset: 0,
      }),
    ).toMatchObject({ total: 1, runs: [{ id: kafkaRun.id }] });
    expect(repository.list({ limit: 1, offset: 1 })).toMatchObject({
      total: 2,
      runs: [{}],
    });
  });

  it('marks pending and running runs as failed after a restart', () => {
    const pending = repository.create(configuration);
    const running = repository.create(configuration);
    repository.updateStatus(running.id, 'running');
    const completed = repository.create(configuration);
    repository.updateStatus(completed.id, 'completed');

    expect(repository.recoverInterruptedRuns()).toBe(2);
    expect(repository.getById(pending.id)).toMatchObject({
      status: 'failed',
      errors: [{ code: 'RUN_INTERRUPTED' }],
    });
    expect(repository.getById(running.id)).toMatchObject({
      status: 'failed',
      errors: [{ code: 'RUN_INTERRUPTED' }],
    });
    expect(repository.getById(completed.id)).toMatchObject({
      status: 'completed',
      errors: [],
    });
  });
});
