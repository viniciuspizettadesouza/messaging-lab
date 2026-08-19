import { z } from 'zod';

import {
  runConfigurationSchema,
  suiteCombinationSchema,
  suiteConfigurationSchema,
  suiteNameSchema,
} from './configuration.js';
import {
  benchmarkMetricsSchema,
  brokerCapabilitiesSchema,
  brokerIdSchema,
  runStatusSchema,
  suiteStatusSchema,
} from './domain.js';

export const isoTimestampSchema = z.string().datetime({ offset: true });
export const runIdSchema = z.uuid();
export const suiteIdSchema = z.uuid();

export const runErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    occurredAt: isoTimestampSchema,
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const runSchema = z
  .object({
    id: runIdSchema,
    configuration: runConfigurationSchema,
    status: runStatusSchema,
    createdAt: isoTimestampSchema,
    startedAt: isoTimestampSchema.nullable(),
    finishedAt: isoTimestampSchema.nullable(),
    metrics: benchmarkMetricsSchema.nullable(),
    notes: z.array(z.string().min(1)),
    errors: z.array(runErrorSchema),
  })
  .strict();

export const suiteErrorSchema = runErrorSchema;

export const suiteProgressSchema = z
  .object({
    completedRuns: z.number().int().nonnegative(),
    totalRuns: z.number().int().positive(),
    currentPosition: z.number().int().nonnegative().nullable(),
    currentCombination: suiteCombinationSchema.nullable(),
    currentRepetition: z.number().int().positive().nullable(),
    activeRunId: runIdSchema.nullable(),
  })
  .strict()
  .superRefine(({ completedRuns, totalRuns, currentPosition }, context) => {
    if (completedRuns > totalRuns) {
      context.addIssue({
        code: 'custom',
        message: 'Completed runs cannot exceed total runs.',
        path: ['completedRuns'],
      });
    }
    if (currentPosition !== null && currentPosition >= totalRuns) {
      context.addIssue({
        code: 'custom',
        message: 'Current position must be within the suite execution order.',
        path: ['currentPosition'],
      });
    }
  });

export const suiteSummarySchema = z
  .object({
    totalRuns: z.number().int().positive(),
    pendingRuns: z.number().int().nonnegative(),
    runningRuns: z.number().int().nonnegative(),
    completedRuns: z.number().int().nonnegative(),
    failedRuns: z.number().int().nonnegative(),
    timedOutRuns: z.number().int().nonnegative(),
    cancelledRuns: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((summary, context) => {
    const accountedRuns =
      summary.pendingRuns +
      summary.runningRuns +
      summary.completedRuns +
      summary.failedRuns +
      summary.timedOutRuns +
      summary.cancelledRuns;

    if (accountedRuns !== summary.totalRuns) {
      context.addIssue({
        code: 'custom',
        message: 'Suite summary counts must equal total runs.',
        path: ['totalRuns'],
      });
    }
  });

export const suiteRunSchema = z
  .object({
    position: z.number().int().nonnegative(),
    combinationIndex: z.number().int().nonnegative(),
    repetition: z.number().int().positive(),
    combination: suiteCombinationSchema,
    run: runSchema.nullable(),
  })
  .strict();

export const suiteSchema = z
  .object({
    id: suiteIdSchema,
    name: suiteNameSchema,
    status: suiteStatusSchema,
    configuration: suiteConfigurationSchema,
    progress: suiteProgressSchema,
    summary: suiteSummarySchema,
    createdAt: isoTimestampSchema,
    startedAt: isoTimestampSchema.nullable(),
    finishedAt: isoTimestampSchema.nullable(),
    stopReason: z.string().min(1).nullable(),
    errors: z.array(suiteErrorSchema),
    runs: z.array(suiteRunSchema),
  })
  .strict();

export const suiteResponseSchema = suiteSchema;
export const suiteIdParamsSchema = z.object({ id: suiteIdSchema }).strict();
export const suitesQuerySchema = z
  .object({
    status: suiteStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().nonnegative().default(0),
  })
  .strict();
export const suitesResponseSchema = z
  .object({
    suites: z.array(suiteSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  })
  .strict();
export const cancelSuiteResponseSchema = z
  .object({
    suiteId: suiteIdSchema,
    cancellationRequested: z.literal(true),
  })
  .strict();

export const brokerHealthSchema = z
  .object({
    status: z.enum(['healthy', 'unhealthy', 'unknown']),
    latencyMs: z.number().finite().nonnegative().nullable(),
    checkedAt: isoTimestampSchema,
    error: z.string().min(1).nullable(),
  })
  .strict();

export const brokerInfoSchema = z
  .object({
    id: brokerIdSchema,
    health: brokerHealthSchema,
    capabilities: brokerCapabilitiesSchema,
  })
  .strict();

export const brokersResponseSchema = z
  .object({ brokers: z.array(brokerInfoSchema) })
  .strict();

export const runResponseSchema = runSchema;

export const runIdParamsSchema = z.object({ id: runIdSchema }).strict();

export const runsQuerySchema = z
  .object({
    broker: brokerIdSchema.optional(),
    status: runStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().nonnegative().default(0),
  })
  .strict();

export const runsResponseSchema = z
  .object({
    runs: z.array(runSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  })
  .strict();

export const cancelRunResponseSchema = z
  .object({
    runId: runIdSchema,
    cancellationRequested: z.literal(true),
  })
  .strict();

export const errorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();

const runEventBase = {
  runId: runIdSchema,
  sequence: z.number().int().nonnegative(),
  timestamp: isoTimestampSchema,
};

export const runPhaseSchema = z.enum([
  'preparing',
  'warming-up',
  'publishing',
  'consuming',
  'cleaning-up',
]);

export const runEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...runEventBase,
      type: z.literal('status'),
      status: runStatusSchema,
    })
    .strict(),
  z
    .object({
      ...runEventBase,
      type: z.literal('progress'),
      phase: runPhaseSchema,
      completedUnits: z.number().int().nonnegative(),
      totalUnits: z.number().int().positive(),
      publishedMessages: z.number().int().nonnegative(),
      receivedMessages: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...runEventBase,
      type: z.literal('metrics'),
      metrics: benchmarkMetricsSchema,
    })
    .strict(),
  z
    .object({
      ...runEventBase,
      type: z.literal('error'),
      error: runErrorSchema,
    })
    .strict(),
  z
    .object({
      ...runEventBase,
      type: z.literal('heartbeat'),
    })
    .strict(),
]);

const suiteEventBase = {
  suiteId: suiteIdSchema,
  sequence: z.number().int().nonnegative(),
  timestamp: isoTimestampSchema,
};

export const suiteEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...suiteEventBase,
      type: z.literal('status'),
      status: suiteStatusSchema,
    })
    .strict(),
  z
    .object({
      ...suiteEventBase,
      type: z.literal('progress'),
      progress: suiteProgressSchema,
    })
    .strict(),
  z
    .object({
      ...suiteEventBase,
      type: z.literal('run-event'),
      runEvent: runEventSchema,
    })
    .strict(),
  z
    .object({
      ...suiteEventBase,
      type: z.literal('summary'),
      summary: suiteSummarySchema,
    })
    .strict(),
  z
    .object({
      ...suiteEventBase,
      type: z.literal('error'),
      error: suiteErrorSchema,
    })
    .strict(),
  z
    .object({
      ...suiteEventBase,
      type: z.literal('heartbeat'),
    })
    .strict(),
]);

export type RunError = z.infer<typeof runErrorSchema>;
export type Run = z.infer<typeof runSchema>;
export type BrokerHealth = z.infer<typeof brokerHealthSchema>;
export type BrokerInfo = z.infer<typeof brokerInfoSchema>;
export type BrokersResponse = z.infer<typeof brokersResponseSchema>;
export type RunResponse = z.infer<typeof runResponseSchema>;
export type RunIdParams = z.infer<typeof runIdParamsSchema>;
export type RunsQuery = z.output<typeof runsQuerySchema>;
export type RunsResponse = z.infer<typeof runsResponseSchema>;
export type CancelRunResponse = z.infer<typeof cancelRunResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type RunPhase = z.infer<typeof runPhaseSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;
export type SuiteId = z.infer<typeof suiteIdSchema>;
export type SuiteError = z.infer<typeof suiteErrorSchema>;
export type SuiteProgress = z.infer<typeof suiteProgressSchema>;
export type SuiteSummary = z.infer<typeof suiteSummarySchema>;
export type SuiteRun = z.infer<typeof suiteRunSchema>;
export type Suite = z.infer<typeof suiteSchema>;
export type SuiteEvent = z.infer<typeof suiteEventSchema>;
export type SuiteResponse = z.infer<typeof suiteResponseSchema>;
export type SuiteIdParams = z.infer<typeof suiteIdParamsSchema>;
export type SuitesQuery = z.output<typeof suitesQuerySchema>;
export type SuitesResponse = z.infer<typeof suitesResponseSchema>;
export type CancelSuiteResponse = z.infer<typeof cancelSuiteResponseSchema>;
