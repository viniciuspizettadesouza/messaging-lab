import { z } from 'zod';

import { brokerIdSchema, scenarioIdSchema } from './domain.js';

export const BENCHMARK_LIMITS = {
  messageCount: { min: 1, max: 1_000_000, default: 10_000 },
  payloadSizeBytes: { min: 1, max: 1_048_576, default: 1_024 },
  producerConcurrency: { min: 1, max: 32, default: 1 },
  consumerCount: { min: 1, max: 64, default: 1 },
  timeoutMs: { min: 1_000, max: 600_000, default: 120_000 },
} as const;

export const BENCHMARK_DEFAULTS = {
  messageCount: BENCHMARK_LIMITS.messageCount.default,
  payloadSizeBytes: BENCHMARK_LIMITS.payloadSizeBytes.default,
  producerConcurrency: BENCHMARK_LIMITS.producerConcurrency.default,
  consumerCount: BENCHMARK_LIMITS.consumerCount.default,
  timeoutMs: BENCHMARK_LIMITS.timeoutMs.default,
} as const;

const boundedInteger = (limits: { min: number; max: number }) =>
  z.number().int().min(limits.min).max(limits.max);

const configurationFields = {
  broker: brokerIdSchema,
  scenario: scenarioIdSchema,
  messageCount: boundedInteger(BENCHMARK_LIMITS.messageCount),
  payloadSizeBytes: boundedInteger(BENCHMARK_LIMITS.payloadSizeBytes),
  producerConcurrency: boundedInteger(BENCHMARK_LIMITS.producerConcurrency),
  consumerCount: boundedInteger(BENCHMARK_LIMITS.consumerCount),
  timeoutMs: boundedInteger(BENCHMARK_LIMITS.timeoutMs),
};

export const runConfigurationSchema = z.object(configurationFields).strict();

export const startRunRequestSchema = z
  .object({
    broker: configurationFields.broker,
    scenario: configurationFields.scenario,
    messageCount: configurationFields.messageCount.default(
      BENCHMARK_DEFAULTS.messageCount,
    ),
    payloadSizeBytes: configurationFields.payloadSizeBytes.default(
      BENCHMARK_DEFAULTS.payloadSizeBytes,
    ),
    producerConcurrency: configurationFields.producerConcurrency.default(
      BENCHMARK_DEFAULTS.producerConcurrency,
    ),
    consumerCount: configurationFields.consumerCount.default(
      BENCHMARK_DEFAULTS.consumerCount,
    ),
    timeoutMs: configurationFields.timeoutMs.default(
      BENCHMARK_DEFAULTS.timeoutMs,
    ),
  })
  .strict();

export type RunConfiguration = z.infer<typeof runConfigurationSchema>;
export type StartRunRequest = z.input<typeof startRunRequestSchema>;
export type ResolvedStartRunRequest = z.output<typeof startRunRequestSchema>;
