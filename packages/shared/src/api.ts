import { z } from 'zod';

import { runConfigurationSchema } from './configuration.js';
import {
  benchmarkMetricsSchema,
  brokerCapabilitiesSchema,
  brokerIdSchema,
  runStatusSchema,
} from './domain.js';

export const isoTimestampSchema = z.string().datetime({ offset: true });
export const runIdSchema = z.uuid();

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
