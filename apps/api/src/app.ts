import type { DatabaseSync } from 'node:sqlite';

import {
  BROKER_CAPABILITIES,
  BROKER_IDS,
  brokersResponseSchema,
  cancelRunResponseSchema,
  cancelSuiteResponseSchema,
  createSuiteRequestSchema,
  deleteExperimentResponseSchema,
  errorResponseSchema,
  recoveryExperimentRequestSchema,
  recoveryExperimentResultSchema,
  runIdParamsSchema,
  runResponseSchema,
  runsQuerySchema,
  runsResponseSchema,
  startRunRequestSchema,
  suiteIdParamsSchema,
  suiteResponseSchema,
  suitesQuerySchema,
  suitesResponseSchema,
  type BrokerHealth,
  type BrokerId,
} from '@messaging-lab/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';

import { createBrokerAdapters } from './adapters/index.js';
import { RunEventStore, formatSseEvent } from './benchmark/run-events.js';
import {
  RunManager,
  type BrokerAdapterRegistry,
} from './benchmark/run-manager.js';
import { SuiteEventStore } from './benchmark/suite-events.js';
import { SuiteScheduler } from './benchmark/suite-scheduler.js';
import { loadConfig, type ApiConfig } from './config.js';
import { openDatabase } from './database.js';
import { ApiError } from './errors.js';
import { RunRepository } from './run-repository.js';
import { SuiteRepository } from './suite-repository.js';
import { serializeSuiteCsv } from './suite-export.js';
import { captureEnvironmentSnapshot } from './environment-snapshot.js';
import { RecoveryExperimentEngine } from './recovery/recovery-engine.js';

export interface Application {
  readonly app: FastifyInstance;
  readonly repository: RunRepository;
  readonly runManager: RunManager;
  readonly events: RunEventStore;
  readonly suiteRepository: SuiteRepository;
  readonly suiteScheduler: SuiteScheduler;
  readonly suiteEvents: SuiteEventStore;
  readonly recoveryEngine: RecoveryExperimentEngine;
}

export interface ApplicationOptions {
  readonly config?: ApiConfig;
  readonly database?: DatabaseSync;
  readonly brokerAdapters?: BrokerAdapterRegistry;
  readonly brokerHealthChecker?: (broker: BrokerId) => Promise<BrokerHealth>;
  readonly logger?: boolean;
}

export function createApplication(
  options: ApplicationOptions = {},
): Application {
  const config = options.config ?? loadConfig();
  const database = options.database ?? openDatabase(config.databaseUrl);
  const repository = new RunRepository(database);
  const app = Fastify({
    logger: options.logger ?? config.nodeEnv !== 'test',
  });
  const adapters = options.brokerAdapters ?? createBrokerAdapters(config);
  const events = new RunEventStore();
  const runManager = new RunManager(repository, adapters, events);
  const suiteRepository = new SuiteRepository(database, repository);
  const suiteEvents = new SuiteEventStore();
  const suiteScheduler = new SuiteScheduler(
    suiteRepository,
    runManager,
    events,
    suiteEvents,
    () => captureEnvironmentSnapshot(config),
  );
  const brokerHealthChecker =
    options.brokerHealthChecker ??
    (async (broker: BrokerId) => adapters[broker].checkHealth());
  const recoveryEngine = new RecoveryExperimentEngine(adapters);
  const recoveredRuns = repository.recoverInterruptedRuns();
  const recoveredSuites = suiteRepository.recoverInterruptedSuites();

  if (recoveredRuns > 0) {
    app.log.warn({ recoveredRuns }, 'Marked interrupted runs as failed');
  }
  if (recoveredSuites > 0) {
    app.log.warn({ recoveredSuites }, 'Marked interrupted suites as stopped');
  }

  app.setNotFoundHandler(async (request, reply) => {
    return reply.status(404).send(
      errorResponseSchema.parse({
        error: {
          code: 'NOT_FOUND',
          message: `Route ${request.method} ${request.url} was not found.`,
        },
      }),
    );
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send(
        errorResponseSchema.parse({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The request is invalid.',
            details: {
              issues: error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
              })),
            },
          },
        }),
      );
    }

    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send(
        errorResponseSchema.parse({
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        }),
      );
    }

    const statusCode = getClientErrorStatus(error);
    if (statusCode) {
      return reply.status(statusCode).send({
        error: {
          code: 'BAD_REQUEST',
          message:
            error instanceof Error ? error.message : 'The request is invalid.',
        },
      });
    }

    request.log.error({ err: error }, 'Unhandled request error');
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred.',
      },
    });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/api/brokers', async () => {
    const healthEntries = await Promise.all(
      BROKER_IDS.map(
        async (id) => [id, await brokerHealthChecker(id)] as const,
      ),
    );
    const health = Object.fromEntries(healthEntries) as Record<
      BrokerId,
      BrokerHealth
    >;

    return brokersResponseSchema.parse({
      brokers: BROKER_IDS.map((id) => ({
        id,
        health: health[id],
        capabilities: BROKER_CAPABILITIES[id],
      })),
    });
  });

  app.post('/api/recovery-experiments', async (request) => {
    const experiment = recoveryExperimentRequestSchema.parse(request.body);
    const controller = new AbortController();
    const cancel = () =>
      controller.abort(new Error('The client disconnected.'));
    request.raw.once('aborted', cancel);
    try {
      return recoveryExperimentResultSchema.parse(
        await recoveryEngine.execute(experiment, controller.signal),
      );
    } finally {
      request.raw.off('aborted', cancel);
    }
  });

  app.get('/api/runs', async (request) => {
    const query = runsQuerySchema.parse(request.query);
    const result = repository.list(query);
    return runsResponseSchema.parse({
      runs: result.runs,
      total: result.total,
      limit: query.limit,
      offset: query.offset,
    });
  });

  app.get('/api/runs/:id', async (request) => {
    const { id } = runIdParamsSchema.parse(request.params);
    const run = repository.getById(id);

    if (!run) {
      throw new ApiError(404, 'RUN_NOT_FOUND', `Run ${id} was not found.`);
    }

    return runResponseSchema.parse(run);
  });

  app.post('/api/runs', async (request, reply) => {
    if (suiteScheduler.activeSuiteId) {
      throw new ApiError(
        409,
        'SUITE_ALREADY_ACTIVE',
        `Suite ${suiteScheduler.activeSuiteId} is already active.`,
        { activeSuiteId: suiteScheduler.activeSuiteId },
      );
    }
    const configuration = startRunRequestSchema.parse(request.body);
    const run = runManager.start(configuration);
    return reply.status(202).send(runResponseSchema.parse(run));
  });

  app.post('/api/suites', async (request, reply) => {
    const suiteRequest = createSuiteRequestSchema.parse(request.body);
    const suite = suiteScheduler.start(suiteRequest);
    return reply.status(202).send(suiteResponseSchema.parse(suite));
  });

  app.get('/api/suites', async (request) => {
    const query = suitesQuerySchema.parse(request.query);
    const result = suiteRepository.list(query);
    return suitesResponseSchema.parse({
      suites: result.suites,
      total: result.total,
      limit: query.limit,
      offset: query.offset,
    });
  });

  app.get('/api/suites/:id', async (request) => {
    const { id } = suiteIdParamsSchema.parse(request.params);
    const suite = suiteRepository.getById(id);
    if (!suite) {
      throw new ApiError(404, 'SUITE_NOT_FOUND', `Suite ${id} was not found.`);
    }
    return suiteResponseSchema.parse(suite);
  });

  app.get('/api/suites/:id/export', async (request, reply) => {
    const { id } = suiteIdParamsSchema.parse(request.params);
    const { format } = z
      .object({ format: z.enum(['json', 'csv']) })
      .strict()
      .parse(request.query);
    const suite = suiteRepository.getById(id);
    if (!suite) {
      throw new ApiError(404, 'SUITE_NOT_FOUND', `Suite ${id} was not found.`);
    }
    const filename = `messaging-lab-suite-${id}.${format}`;
    reply.header('content-disposition', `attachment; filename="${filename}"`);
    if (format === 'csv') {
      return reply
        .type('text/csv; charset=utf-8')
        .send(serializeSuiteCsv(suite));
    }
    return reply
      .type('application/json; charset=utf-8')
      .send(JSON.stringify(suiteResponseSchema.parse(suite), null, 2));
  });

  app.delete('/api/suites/:id', async (request) => {
    const { id } = suiteIdParamsSchema.parse(request.params);
    const suite = suiteRepository.getById(id);
    if (!suite) {
      throw new ApiError(404, 'SUITE_NOT_FOUND', `Suite ${id} was not found.`);
    }
    if (!isTerminalSuite(suite.status)) {
      throw new ApiError(
        409,
        'SUITE_NOT_TERMINAL',
        'Only terminal suites can be deleted.',
      );
    }
    const deletedRuns = suiteRepository.delete(id) ?? 0;
    return deleteExperimentResponseSchema.parse({
      id,
      deleted: true,
      deletedRuns,
    });
  });

  app.post('/api/suites/:id/cancel', async (request, reply) => {
    const { id } = suiteIdParamsSchema.parse(request.params);
    suiteScheduler.cancel(id);
    return reply.status(202).send(
      cancelSuiteResponseSchema.parse({
        suiteId: id,
        cancellationRequested: true,
      }),
    );
  });

  app.get('/api/suites/:id/events', async (request, reply) => {
    const { id } = suiteIdParamsSchema.parse(request.params);
    const suite = suiteRepository.getById(id);
    if (!suite) {
      throw new ApiError(404, 'SUITE_NOT_FOUND', `Suite ${id} was not found.`);
    }

    if (suiteEvents.history(id).length === 0) {
      suiteEvents.publish(id, { type: 'progress', progress: suite.progress });
      suiteEvents.publish(id, { type: 'summary', summary: suite.summary });
      suiteEvents.publish(id, { type: 'status', status: suite.status });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    reply.raw.flushHeaders();

    const history = suiteEvents.history(id);
    for (const event of history) reply.raw.write(formatSseEvent(event));
    if (
      history.some(
        (event) => event.type === 'status' && isTerminalSuite(event.status),
      )
    ) {
      reply.raw.end();
      return;
    }

    let unsubscribe: () => void = () => undefined;
    const heartbeat = setInterval(
      () => reply.raw.write(': heartbeat\n\n'),
      15_000,
    );
    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
      if (!reply.raw.writableEnded) reply.raw.end();
    };
    unsubscribe = suiteEvents.subscribe(id, (event) => {
      reply.raw.write(formatSseEvent(event));
      if (event.type === 'status' && isTerminalSuite(event.status)) close();
    });
    request.raw.once('close', close);
  });

  app.post('/api/runs/:id/cancel', async (request, reply) => {
    const { id } = runIdParamsSchema.parse(request.params);
    runManager.cancel(id);
    return reply.status(202).send(
      cancelRunResponseSchema.parse({
        runId: id,
        cancellationRequested: true,
      }),
    );
  });

  app.delete('/api/runs/:id', async (request) => {
    const { id } = runIdParamsSchema.parse(request.params);
    const run = repository.getById(id);
    if (!run) {
      throw new ApiError(404, 'RUN_NOT_FOUND', `Run ${id} was not found.`);
    }
    if (!isTerminal(run.status)) {
      throw new ApiError(
        409,
        'RUN_NOT_TERMINAL',
        'Only terminal runs can be deleted.',
      );
    }
    try {
      repository.deleteStandalone(id);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Suite-owned')) {
        throw new ApiError(
          409,
          'RUN_BELONGS_TO_SUITE',
          'Suite-owned runs must be deleted with their suite.',
        );
      }
      throw error;
    }
    return deleteExperimentResponseSchema.parse({
      id,
      deleted: true,
      deletedRuns: 1,
    });
  });

  app.get('/api/runs/:id/events', async (request, reply) => {
    const { id } = runIdParamsSchema.parse(request.params);
    if (!repository.getById(id)) {
      throw new ApiError(404, 'RUN_NOT_FOUND', `Run ${id} was not found.`);
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    reply.raw.flushHeaders();

    const history = events.history(id);
    for (const event of history) reply.raw.write(formatSseEvent(event));
    if (
      history.some(
        (event) => event.type === 'status' && isTerminal(event.status),
      )
    ) {
      reply.raw.end();
      return;
    }

    let unsubscribe: () => void = () => undefined;
    const heartbeat = setInterval(
      () => reply.raw.write(': heartbeat\n\n'),
      15_000,
    );
    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
      if (!reply.raw.writableEnded) reply.raw.end();
    };
    unsubscribe = events.subscribe(id, (event) => {
      reply.raw.write(formatSseEvent(event));
      if (event.type === 'status' && isTerminal(event.status)) close();
    });
    request.raw.once('close', close);
  });

  app.addHook('onClose', async () => {
    await suiteScheduler.shutdown();
    await runManager.shutdown();
    database.close();
  });

  return {
    app,
    repository,
    runManager,
    events,
    suiteRepository,
    suiteScheduler,
    suiteEvents,
    recoveryEngine,
  };
}

function getClientErrorStatus(error: unknown): number | null {
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
    ? statusCode
    : null;
}

function isTerminal(status: string): boolean {
  return ['completed', 'failed', 'timed-out', 'cancelled'].includes(status);
}

function isTerminalSuite(status: string): boolean {
  return ['completed', 'failed', 'cancelled', 'stopped'].includes(status);
}
