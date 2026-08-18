import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BENCHMARK_DEFAULTS,
  brokersResponseSchema,
  errorResponseSchema,
  runResponseSchema,
  runsResponseSchema,
} from '@messaging-lab/shared';

import { createApplication, type Application } from './app.js';
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
    application = createApplication({
      config,
      database: openDatabase(':memory:'),
      logger: false,
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
});
