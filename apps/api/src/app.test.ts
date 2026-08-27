import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BENCHMARK_DEFAULTS,
  brokersResponseSchema,
  cancelRunResponseSchema,
  cancelSuiteResponseSchema,
  deleteExperimentResponseSchema,
  errorResponseSchema,
  runEventSchema,
  runResponseSchema,
  runsResponseSchema,
  recoveryExperimentResultSchema,
  suiteEventSchema,
  suiteResponseSchema,
  suitesResponseSchema,
  type SuiteConfiguration,
} from '@messaging-lab/shared';

import { createApplication, type Application } from './app.js';
import { ImmediateAdapter } from './benchmark/fake-adapter.test-helper.js';
import type { ApiConfig } from './config.js';
import { openDatabase } from './database.js';
import { RunRepository } from './run-repository.js';
import { SuiteRepository } from './suite-repository.js';
import { testEnvironmentSnapshot } from './test-environment.test-helper.js';

const config: ApiConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 3_000,
  databaseUrl: ':memory:',
  redisUrl: 'redis://localhost:6379',
  kafkaBrokers: ['localhost:9092'],
  rabbitMqUrl: 'amqp://localhost:5672',
  rabbitMqManagementUrl: 'http://localhost:15672',
};

describe('API', () => {
  let application: Application;

  beforeEach(() => {
    const adapter = new ImmediateAdapter();
    application = createApplication({
      config,
      database: openDatabase(':memory:'),
      logger: false,
      brokerAdapters: {
        redis: adapter,
        kafka: adapter,
        rabbitmq: adapter,
      },
      brokerHealthChecker: async (broker) => ({
        status: broker === 'redis' ? 'unhealthy' : 'healthy',
        latencyMs: broker === 'redis' ? null : 1,
        checkedAt: '2026-08-18T12:00:00.000Z',
        error: broker === 'redis' ? 'Connection refused.' : null,
      }),
    });
  });

  afterEach(async () => application.app.close());

  it('returns API health and all broker capabilities', async () => {
    const healthResponse = await application.app.inject({
      method: 'GET',
      url: '/health',
    });
    const brokersResponse = await application.app.inject({
      method: 'GET',
      url: '/api/brokers',
    });

    expect(healthResponse.statusCode).toBe(200);
    expect(healthResponse.json()).toEqual({ status: 'ok' });
    expect(brokersResponse.statusCode).toBe(200);
    const brokers = brokersResponseSchema.parse(brokersResponse.json()).brokers;
    expect(brokers).toHaveLength(3);
    expect(brokers.find(({ id }) => id === 'redis')?.health.status).toBe(
      'unhealthy',
    );
    expect(brokers.find(({ id }) => id === 'kafka')?.health.status).toBe(
      'healthy',
    );
  });

  it('runs broker-native recovery experiments outside performance history', async () => {
    const response = await application.app.inject({
      method: 'POST',
      url: '/api/recovery-experiments',
      payload: {
        type: 'kafka-committed-offset-recovery',
        messageCount: 5,
        interruptAfterMessages: 2,
        timeoutMs: 1_000,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(recoveryExperimentResultSchema.parse(response.json())).toMatchObject(
      {
        type: 'kafka-committed-offset-recovery',
        status: 'completed',
        deterministicInterruption: { afterMessages: 2 },
        observations: {
          publishedMessages: 5,
          redeliveredMessages: 1,
          duplicateMessages: 0,
          lostMessages: 0,
          errorCount: 0,
        },
        resourceCleanup: { failures: [] },
      },
    );
    expect(application.repository.list({ limit: 20, offset: 0 }).total).toBe(0);
  });

  it('lists, filters, and retrieves persisted runs', async () => {
    application.repository.create({
      broker: 'redis',
      scenario: 'fan-out',
      ...BENCHMARK_DEFAULTS,
    });
    const kafkaRun = application.repository.create(
      {
        broker: 'kafka',
        scenario: 'competing-consumers',
        ...BENCHMARK_DEFAULTS,
      },
      { name: 'Kafka baseline', description: 'Named standalone run.' },
    );

    const listResponse = await application.app.inject({
      method: 'GET',
      url: `/api/runs?broker=kafka&scenario=competing-consumers&dateFrom=${kafkaRun.createdAt.slice(0, 10)}&dateTo=${kafkaRun.createdAt.slice(0, 10)}&limit=10&offset=0`,
    });
    const detailResponse = await application.app.inject({
      method: 'GET',
      url: `/api/runs/${kafkaRun.id}`,
    });

    expect(listResponse.statusCode).toBe(200);
    expect(runsResponseSchema.parse(listResponse.json())).toMatchObject({
      total: 1,
      runs: [{ id: kafkaRun.id, name: 'Kafka baseline' }],
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(runResponseSchema.parse(detailResponse.json()).id).toBe(kafkaRun.id);

    application.repository.updateStatus(kafkaRun.id, 'completed');
    const deleteResponse = await application.app.inject({
      method: 'DELETE',
      url: `/api/runs/${kafkaRun.id}`,
    });
    expect(deleteExperimentResponseSchema.parse(deleteResponse.json())).toEqual(
      {
        id: kafkaRun.id,
        deleted: true,
        deletedRuns: 1,
      },
    );
  });

  it('returns structured validation and not-found errors', async () => {
    const invalidQuery = await application.app.inject({
      method: 'GET',
      url: '/api/runs?limit=101',
    });
    const missingRun = await application.app.inject({
      method: 'GET',
      url: '/api/runs/11111111-1111-4111-8111-111111111111',
    });
    const missingRoute = await application.app.inject({
      method: 'GET',
      url: '/missing',
    });

    expect(invalidQuery.statusCode).toBe(400);
    expect(errorResponseSchema.parse(invalidQuery.json())).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(missingRun.statusCode).toBe(404);
    expect(errorResponseSchema.parse(missingRun.json())).toMatchObject({
      error: { code: 'RUN_NOT_FOUND' },
    });
    expect(missingRoute.statusCode).toBe(404);
    expect(errorResponseSchema.parse(missingRoute.json())).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
  });

  it('starts a run and streams its lifecycle and metrics over SSE', async () => {
    const startResponse = await application.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        name: 'Named API run',
        description: 'Standalone API description.',
        broker: 'redis',
        scenario: 'fan-out',
        messageCount: 2,
        payloadSizeBytes: 16,
        consumerCount: 2,
      },
    });

    expect(startResponse.statusCode).toBe(202);
    const started = runResponseSchema.parse(startResponse.json());
    const completed = await waitForCompletedRun(application, started.id);
    expect(completed).toMatchObject({
      name: 'Named API run',
      description: 'Standalone API description.',
    });
    expect(completed.metrics).toMatchObject({
      publishedMessages: 2,
      receivedMessages: 4,
    });

    const eventResponse = await application.app.inject({
      method: 'GET',
      url: `/api/runs/${started.id}/events`,
    });
    const events = eventResponse.body
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => runEventSchema.parse(JSON.parse(line.slice(6))));

    expect(eventResponse.statusCode).toBe(200);
    expect(eventResponse.headers['content-type']).toContain(
      'text/event-stream',
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'progress' }),
        expect.objectContaining({ type: 'metrics' }),
        expect.objectContaining({ type: 'status', status: 'completed' }),
      ]),
    );
  });

  it('cancels the active run through the API', async () => {
    await application.app.close();
    const adapter = new NeverDeliverAdapter();
    application = createApplication({
      config,
      database: openDatabase(':memory:'),
      logger: false,
      brokerAdapters: {
        redis: adapter,
        kafka: adapter,
        rabbitmq: adapter,
      },
    });
    const startResponse = await application.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { broker: 'redis', scenario: 'fan-out', timeoutMs: 2_000 },
    });
    const started = runResponseSchema.parse(startResponse.json());
    await waitForRunStatus(application, started.id, 'running');

    const cancelResponse = await application.app.inject({
      method: 'POST',
      url: `/api/runs/${started.id}/cancel`,
    });

    expect(cancelResponse.statusCode).toBe(202);
    expect(cancelRunResponseSchema.parse(cancelResponse.json())).toEqual({
      runId: started.id,
      cancellationRequested: true,
    });
    await waitForRunStatus(application, started.id, 'cancelled');
    expect(adapter.cleaned).toBe(true);
  });

  it('creates, lists, retrieves, and replays a completed suite over SSE', async () => {
    const createResponse = await application.app.inject({
      method: 'POST',
      url: '/api/suites',
      payload: {
        name: 'API suite',
        description: 'Suite API description.',
        workload: { messageCount: 2, payloadSizeBytes: 16 },
        combinations: [
          { broker: 'redis', scenario: 'competing-consumers' },
          { broker: 'kafka', scenario: 'fan-out' },
        ],
        repetitions: 1,
        orderStrategy: 'rotating',
        cooldownMs: 0,
      },
    });

    expect(createResponse.statusCode).toBe(202);
    const created = suiteResponseSchema.parse(createResponse.json());
    const completed = await waitForSuiteStatus(
      application,
      created.id,
      'completed',
    );
    expect(completed.summary).toMatchObject({
      completedRuns: 2,
      failedRuns: 0,
      byTrack: expect.arrayContaining([
        expect.objectContaining({ comparisonTrack: 'primary', totalRuns: 1 }),
        expect.objectContaining({
          comparisonTrack: 'adjacent-streaming',
          totalRuns: 1,
        }),
      ]),
    });

    const listResponse = await application.app.inject({
      method: 'GET',
      url: `/api/suites?status=completed&broker=kafka&scenario=fan-out&dateFrom=${completed.createdAt.slice(0, 10)}&dateTo=${completed.createdAt.slice(0, 10)}&limit=10&offset=0`,
    });
    const detailResponse = await application.app.inject({
      method: 'GET',
      url: `/api/suites/${created.id}`,
    });
    expect(suitesResponseSchema.parse(listResponse.json())).toMatchObject({
      total: 1,
      suites: [{ id: created.id, description: 'Suite API description.' }],
    });
    expect(suiteResponseSchema.parse(detailResponse.json()).runs).toHaveLength(
      2,
    );
    expect(completed.combinationSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          successfulTrials: 1,
          unsuccessfulTrials: 0,
          throughput: expect.objectContaining({ sampleSize: 1 }),
        }),
      ]),
    );
    expect(completed.environment).toMatchObject({
      application: { version: '0.1.0' },
      host: { logicalCpuCount: expect.any(Number) },
      brokers: {
        redis: { image: 'redis:8.2.1-alpine3.22', version: '8.2.1' },
      },
    });

    const jsonExport = await application.app.inject({
      method: 'GET',
      url: `/api/suites/${created.id}/export?format=json`,
    });
    const csvExport = await application.app.inject({
      method: 'GET',
      url: `/api/suites/${created.id}/export?format=csv`,
    });
    expect(jsonExport.headers['content-disposition']).toContain('.json');
    expect(suiteResponseSchema.parse(jsonExport.json()).runs).toHaveLength(2);
    expect(csvExport.headers['content-type']).toContain('text/csv');
    expect(csvExport.body).toContain('throughput_messages_per_second');
    expect(csvExport.body).toContain('comparison_track');
    expect(csvExport.body).toContain('adjacent-streaming');
    expect(csvExport.body).toContain('environment_captured_at');
    expect(csvExport.body).toContain('redis:8.2.1-alpine3.22');
    expect(csvExport.body.split('\n')).toHaveLength(4);

    const eventResponse = await application.app.inject({
      method: 'GET',
      url: `/api/suites/${created.id}/events`,
    });
    const suiteEvents = eventResponse.body
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => suiteEventSchema.parse(JSON.parse(line.slice(6))));
    expect(suiteEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'status', status: 'pending' }),
        expect.objectContaining({ type: 'status', status: 'running' }),
        expect.objectContaining({ type: 'run-event' }),
        expect.objectContaining({ type: 'progress' }),
        expect.objectContaining({ type: 'summary' }),
        expect.objectContaining({ type: 'status', status: 'completed' }),
      ]),
    );

    const ownedRunIds = completed.runs.flatMap(({ run }) =>
      run ? [run.id] : [],
    );
    const childDelete = await application.app.inject({
      method: 'DELETE',
      url: `/api/runs/${ownedRunIds[0]}`,
    });
    expect(childDelete.statusCode).toBe(409);
    expect(errorResponseSchema.parse(childDelete.json())).toMatchObject({
      error: { code: 'RUN_BELONGS_TO_SUITE' },
    });
    const deleteResponse = await application.app.inject({
      method: 'DELETE',
      url: `/api/suites/${created.id}`,
    });
    expect(deleteExperimentResponseSchema.parse(deleteResponse.json())).toEqual(
      {
        id: created.id,
        deleted: true,
        deletedRuns: 2,
      },
    );
    for (const runId of ownedRunIds) {
      expect(application.repository.getById(runId)).toBeNull();
    }
  });

  it('validates suite creation and returns suite not-found errors', async () => {
    const invalid = await application.app.inject({
      method: 'POST',
      url: '/api/suites',
      payload: {
        name: 'Too large',
        combinations: [
          { broker: 'redis', scenario: 'fan-out' },
          { broker: 'kafka', scenario: 'fan-out' },
          { broker: 'rabbitmq', scenario: 'fan-out' },
          { broker: 'redis', scenario: 'competing-consumers' },
          { broker: 'kafka', scenario: 'competing-consumers' },
          { broker: 'rabbitmq', scenario: 'competing-consumers' },
        ],
        repetitions: 20,
      },
    });
    const missing = await application.app.inject({
      method: 'GET',
      url: '/api/suites/11111111-1111-4111-8111-111111111111',
    });

    expect(invalid.statusCode).toBe(400);
    expect(errorResponseSchema.parse(invalid.json())).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(missing.statusCode).toBe(404);
    expect(errorResponseSchema.parse(missing.json())).toMatchObject({
      error: { code: 'SUITE_NOT_FOUND' },
    });
  });

  it('cancels a suite and its active run through the API', async () => {
    await application.app.close();
    const adapter = new NeverDeliverAdapter();
    application = createApplication({
      config,
      database: openDatabase(':memory:'),
      logger: false,
      brokerAdapters: { redis: adapter, kafka: adapter, rabbitmq: adapter },
    });
    const createResponse = await application.app.inject({
      method: 'POST',
      url: '/api/suites',
      payload: {
        name: 'Cancelable suite',
        combinations: [{ broker: 'redis', scenario: 'fan-out' }],
        repetitions: 2,
        cooldownMs: 0,
      },
    });
    const suite = suiteResponseSchema.parse(createResponse.json());
    await waitForSuiteRunStatus(application, suite.id, 'running');

    const conflictingRun = await application.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { broker: 'kafka', scenario: 'fan-out' },
    });
    expect(conflictingRun.statusCode).toBe(409);

    const cancelResponse = await application.app.inject({
      method: 'POST',
      url: `/api/suites/${suite.id}/cancel`,
    });
    expect(cancelResponse.statusCode).toBe(202);
    expect(cancelSuiteResponseSchema.parse(cancelResponse.json())).toEqual({
      suiteId: suite.id,
      cancellationRequested: true,
    });
    const cancelled = await waitForSuiteStatus(
      application,
      suite.id,
      'cancelled',
    );
    expect(cancelled.runs[0]?.run?.status).toBe('cancelled');
    expect(cancelled.runs[1]?.run).toBeNull();

    const eventResponse = await application.app.inject({
      method: 'GET',
      url: `/api/suites/${suite.id}/events`,
    });
    const statuses = eventResponse.body
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => suiteEventSchema.parse(JSON.parse(line.slice(6))))
      .filter((event) => event.type === 'status')
      .map((event) => event.status);
    expect(statuses).toEqual(
      expect.arrayContaining(['pending', 'running', 'cancelled']),
    );
  });

  it('marks an interrupted suite as stopped when the application starts', async () => {
    await application.app.close();
    const database = openDatabase(':memory:');
    const runs = new RunRepository(database);
    const suites = new SuiteRepository(database, runs);
    const configuration: SuiteConfiguration = {
      workload: BENCHMARK_DEFAULTS,
      combinations: [{ broker: 'redis', scenario: 'fan-out' }],
      repetitions: 1,
      orderStrategy: 'fixed',
      cooldownMs: 0,
    };
    const interrupted = suites.create(
      'Interrupted',
      configuration,
      [
        {
          position: 0,
          combinationIndex: 0,
          repetition: 1,
          combination: configuration.combinations[0]!,
        },
      ],
      testEnvironmentSnapshot,
    );
    const adapter = new ImmediateAdapter();
    application = createApplication({
      config,
      database,
      logger: false,
      brokerAdapters: { redis: adapter, kafka: adapter, rabbitmq: adapter },
    });

    expect(
      application.suiteRepository.requireById(interrupted.id),
    ).toMatchObject({
      status: 'stopped',
      errors: [{ code: 'SUITE_INTERRUPTED' }],
    });
  });
});

async function waitForCompletedRun(application: Application, runId: string) {
  return waitForRunStatus(application, runId, 'completed');
}

async function waitForRunStatus(
  application: Application,
  runId: string,
  status: string,
) {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const run = application.repository.requireById(runId);
    if (run.status === status) return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(`Timed out waiting for the run to become ${status}.`);
}

async function waitForSuiteStatus(
  application: Application,
  suiteId: string,
  status: string,
) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const suite = application.suiteRepository.requireById(suiteId);
    if (suite.status === status) return suite;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for the suite to become ${status}.`);
}

async function waitForSuiteRunStatus(
  application: Application,
  suiteId: string,
  status: string,
) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const suite = application.suiteRepository.requireById(suiteId);
    if (suite.runs.some(({ run }) => run?.status === status)) return suite;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for a suite run to become ${status}.`);
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
