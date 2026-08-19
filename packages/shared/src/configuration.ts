import { z } from 'zod';

import {
  brokerIdSchema,
  scenarioIdSchema,
  suiteOrderStrategySchema,
} from './domain.js';

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

export const SUITE_LIMITS = {
  repetitions: { min: 1, max: 20, default: 3 },
  cooldownMs: { min: 0, max: 60_000, default: 1_000 },
  combinations: { min: 1, max: 6 },
  totalRuns: { max: 100 },
  nameLength: { min: 1, max: 120 },
} as const;
export const EXPERIMENT_DESCRIPTION_MAX_LENGTH = 500;

export const SUITE_DEFAULTS = {
  repetitions: SUITE_LIMITS.repetitions.default,
  cooldownMs: SUITE_LIMITS.cooldownMs.default,
  orderStrategy: 'fixed',
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

const workloadConfigurationFields = {
  messageCount: configurationFields.messageCount,
  payloadSizeBytes: configurationFields.payloadSizeBytes,
  producerConcurrency: configurationFields.producerConcurrency,
  consumerCount: configurationFields.consumerCount,
  timeoutMs: configurationFields.timeoutMs,
};

export const runConfigurationSchema = z.object(configurationFields).strict();

export const workloadConfigurationSchema = z
  .object(workloadConfigurationFields)
  .strict();

export const suiteCombinationSchema = z
  .object({
    broker: brokerIdSchema,
    scenario: scenarioIdSchema,
  })
  .strict();

export const suiteNameSchema = z
  .string()
  .trim()
  .min(SUITE_LIMITS.nameLength.min)
  .max(SUITE_LIMITS.nameLength.max);
export const experimentDescriptionSchema = z
  .string()
  .trim()
  .max(EXPERIMENT_DESCRIPTION_MAX_LENGTH)
  .transform((value) => value || null)
  .nullable()
  .default(null);

export const suiteConfigurationSchema = z
  .object({
    workload: workloadConfigurationSchema,
    combinations: z
      .array(suiteCombinationSchema)
      .min(SUITE_LIMITS.combinations.min)
      .max(SUITE_LIMITS.combinations.max),
    repetitions: boundedInteger(SUITE_LIMITS.repetitions),
    orderStrategy: suiteOrderStrategySchema,
    cooldownMs: boundedInteger(SUITE_LIMITS.cooldownMs),
  })
  .strict()
  .superRefine(({ combinations, repetitions }, context) => {
    const seen = new Set<string>();

    combinations.forEach(({ broker, scenario }, index) => {
      const key = `${broker}:${scenario}`;
      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',
          message: 'Suite combinations must be unique.',
          path: ['combinations', index],
        });
      }
      seen.add(key);
    });

    if (combinations.length * repetitions > SUITE_LIMITS.totalRuns.max) {
      context.addIssue({
        code: 'custom',
        message: `A suite cannot generate more than ${SUITE_LIMITS.totalRuns.max} runs.`,
        path: ['repetitions'],
      });
    }
  });

const workloadRequestSchema = z
  .object({
    messageCount: workloadConfigurationFields.messageCount.default(
      BENCHMARK_DEFAULTS.messageCount,
    ),
    payloadSizeBytes: workloadConfigurationFields.payloadSizeBytes.default(
      BENCHMARK_DEFAULTS.payloadSizeBytes,
    ),
    producerConcurrency:
      workloadConfigurationFields.producerConcurrency.default(
        BENCHMARK_DEFAULTS.producerConcurrency,
      ),
    consumerCount: workloadConfigurationFields.consumerCount.default(
      BENCHMARK_DEFAULTS.consumerCount,
    ),
    timeoutMs: workloadConfigurationFields.timeoutMs.default(
      BENCHMARK_DEFAULTS.timeoutMs,
    ),
  })
  .strict();

export const createSuiteRequestSchema = z
  .object({
    name: suiteNameSchema,
    description: experimentDescriptionSchema,
    workload: workloadRequestSchema.default(BENCHMARK_DEFAULTS),
    combinations: z
      .array(suiteCombinationSchema)
      .min(SUITE_LIMITS.combinations.min)
      .max(SUITE_LIMITS.combinations.max),
    repetitions: boundedInteger(SUITE_LIMITS.repetitions).default(
      SUITE_DEFAULTS.repetitions,
    ),
    orderStrategy: suiteOrderStrategySchema.default(
      SUITE_DEFAULTS.orderStrategy,
    ),
    cooldownMs: boundedInteger(SUITE_LIMITS.cooldownMs).default(
      SUITE_DEFAULTS.cooldownMs,
    ),
  })
  .strict()
  .transform(({ name, description, ...configuration }) => ({
    name,
    description,
    configuration,
  }))
  .pipe(
    z
      .object({
        name: z.string(),
        description: z.string().nullable(),
        configuration: suiteConfigurationSchema,
      })
      .strict(),
  );

export const startRunRequestSchema = z
  .object({
    name: suiteNameSchema.nullable().default(null),
    description: experimentDescriptionSchema,
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
export type WorkloadConfiguration = z.infer<typeof workloadConfigurationSchema>;
export type SuiteCombination = z.infer<typeof suiteCombinationSchema>;
export type SuiteName = z.infer<typeof suiteNameSchema>;
export type SuiteConfiguration = z.infer<typeof suiteConfigurationSchema>;
export type CreateSuiteRequest = z.input<typeof createSuiteRequestSchema>;
export type ResolvedCreateSuiteRequest = z.output<
  typeof createSuiteRequestSchema
>;
export type StartRunRequest = z.input<typeof startRunRequestSchema>;
export type ResolvedStartRunRequest = z.output<typeof startRunRequestSchema>;
