import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BENCHMARK_DEFAULTS,
  brokersResponseSchema,
  cancelRunResponseSchema,
  errorResponseSchema,
  runEventSchema,
  runResponseSchema,
  runsResponseSchema,
} from '@messaging-lab/shared';

import { createApplication, type Application } from './app.js';
import { ImmediateAdapter } from './benchmark/fake-adapter.test-helper.js';
import type { ApiConfig } from './config.js';
import { openDatabase } from './database.js';

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

  it('lists, filters, and retrieves persisted runs', async () => {
    application.repository.create({
      broker: 'redis',
      scenario: 'fan-out',
      ...BENCHMARK_DEFAULTS,
    });
    const kafkaRun = application.repository.create({
      broker: 'kafka',
      scenario: 'competing-consumers',
      ...BENCHMARK_DEFAULTS,
    });

    const listResponse = await application.app.inject({
      method: 'GET',
      url: '/api/runs?broker=kafka&limit=10&offset=0',
    });
    const detailResponse = await application.app.inject({
      method: 'GET',
      url: `/api/runs/${kafkaRun.id}`,
    });

    expect(listResponse.statusCode).toBe(200);
    expect(runsResponseSchema.parse(listResponse.json())).toMatchObject({
      total: 1,
      runs: [{ id: kafkaRun.id }],
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(runResponseSchema.parse(detailResponse.json()).id).toBe(kafkaRun.id);
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
