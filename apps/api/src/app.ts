import type { DatabaseSync } from 'node:sqlite';

import {
  BROKER_CAPABILITIES,
  BROKER_IDS,
  brokersResponseSchema,
  errorResponseSchema,
  runIdParamsSchema,
  runResponseSchema,
  runsQuerySchema,
  runsResponseSchema,
  type BrokerHealth,
  type BrokerId,
} from '@messaging-lab/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import { createBrokerAdapters } from './adapters/index.js';
import { loadConfig, type ApiConfig } from './config.js';
import { openDatabase } from './database.js';
import { ApiError } from './errors.js';
import { RunRepository } from './run-repository.js';

export interface Application {
  readonly app: FastifyInstance;
  readonly repository: RunRepository;
}

export interface ApplicationOptions {
  readonly config?: ApiConfig;
  readonly database?: DatabaseSync;
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
  const adapters = createBrokerAdapters(config);
  const brokerHealthChecker =
    options.brokerHealthChecker ??
    (async (broker: BrokerId) => adapters[broker].checkHealth());
  const recoveredRuns = repository.recoverInterruptedRuns();

  if (recoveredRuns > 0) {
    app.log.warn({ recoveredRuns }, 'Marked interrupted runs as failed');
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

  app.addHook('onClose', async () => {
    database.close();
  });

  return { app, repository };
}

function getClientErrorStatus(error: unknown): number | null {
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
    ? statusCode
    : null;
}
