import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BENCHMARK_DEFAULTS,
  type SuiteConfiguration,
} from '@messaging-lab/shared';

import { openDatabase } from './database.js';
import { RunRepository } from './run-repository.js';
import { SuiteRepository } from './suite-repository.js';
import { testEnvironmentSnapshot } from './test-environment.test-helper.js';

const configuration: SuiteConfiguration = {
  workload: BENCHMARK_DEFAULTS,
  combinations: [
    { broker: 'redis', scenario: 'competing-consumers' },
    { broker: 'kafka', scenario: 'fan-out' },
  ],
  repetitions: 1,
  orderStrategy: 'fixed',
  cooldownMs: 0,
};
const order = configuration.combinations.map((combination, position) => ({
  position,
  combinationIndex: position,
  repetition: 1,
  combination,
}));

describe('SuiteRepository', () => {
  let database: ReturnType<typeof openDatabase>;
  let runs: RunRepository;
  let suites: SuiteRepository;
  let idCounter: number;

  beforeEach(() => {
    database = openDatabase(':memory:');
    idCounter = 1;
    const createId = () =>
      `11111111-1111-4111-8111-${String(idCounter++).padStart(12, '0')}`;
    runs = new RunRepository(
      database,
      () => new Date('2026-08-19T12:00:00.000Z'),
      createId,
    );
    suites = new SuiteRepository(
      database,
      runs,
      () => new Date('2026-08-19T12:00:00.000Z'),
      createId,
    );
  });

  afterEach(() => database.close());

  it('persists the complete order and updates suite-run membership', () => {
    const suite = suites.create(
      'Repository suite',
      configuration,
      order,
      testEnvironmentSnapshot,
    );
    expect(suite.runs).toEqual([
      expect.objectContaining({ position: 0, run: null }),
      expect.objectContaining({ position: 1, run: null }),
    ]);
    expect(suite.environment).toEqual(testEnvironmentSnapshot);

    suites.updateStatus(suite.id, 'running');
    const firstCombination = configuration.combinations[0]!;
    const run = runs.create({
      ...configuration.workload,
      ...firstCombination,
    });
    suites.attachRun(suite.id, 0, run.id);
    runs.updateStatus(run.id, 'running');
    runs.updateStatus(run.id, 'completed');
    const completed = suites.updateStatus(suite.id, 'completed');

    expect(completed).toMatchObject({
      status: 'completed',
      progress: { completedRuns: 1, totalRuns: 2 },
      summary: { completedRuns: 1, pendingRuns: 1 },
      runs: [{ run: { id: run.id } }, { run: null }],
    });
    expect(
      suites.list({ status: 'completed', limit: 20, offset: 0 }),
    ).toMatchObject({
      total: 1,
      suites: [{ id: suite.id }],
    });
  });

  it('records errors and stops interrupted suites during recovery', () => {
    const pending = suites.create(
      'Pending',
      configuration,
      order,
      testEnvironmentSnapshot,
    );
    const running = suites.create(
      'Running',
      configuration,
      order,
      testEnvironmentSnapshot,
    );
    suites.updateStatus(running.id, 'running');
    const completed = suites.create(
      'Completed',
      configuration,
      order,
      testEnvironmentSnapshot,
    );
    suites.updateStatus(completed.id, 'completed');

    expect(suites.recoverInterruptedSuites()).toBe(2);
    expect(suites.requireById(pending.id)).toMatchObject({
      status: 'stopped',
      errors: [{ code: 'SUITE_INTERRUPTED' }],
    });
    expect(suites.requireById(running.id)).toMatchObject({
      status: 'stopped',
      stopReason: expect.stringContaining('restarted'),
    });
    expect(suites.requireById(completed.id).status).toBe('completed');
  });

  it('rejects an incomplete execution order transactionally', () => {
    expect(() =>
      suites.create(
        'Invalid',
        configuration,
        order.slice(0, 1),
        testEnvironmentSnapshot,
      ),
    ).toThrow('execution order');
    expect(suites.list({ limit: 20, offset: 0 }).total).toBe(0);
  });
});
