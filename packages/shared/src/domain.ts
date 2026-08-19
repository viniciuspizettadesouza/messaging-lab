import { z } from 'zod';

export const BROKER_IDS = ['redis', 'kafka', 'rabbitmq'] as const;
export const SCENARIO_IDS = ['fan-out', 'competing-consumers'] as const;
export const RUN_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'timed-out',
  'cancelled',
] as const;
export const SUITE_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'stopped',
] as const;
export const SUITE_ORDER_STRATEGIES = [
  'fixed',
  'rotating',
  'randomized',
] as const;
export const CAPABILITY_FLAGS = [
  'persistence',
  'acknowledgements',
  'consumerRecovery',
  'replay',
] as const;

export const brokerIdSchema = z.enum(BROKER_IDS);
export const scenarioIdSchema = z.enum(SCENARIO_IDS);
export const runStatusSchema = z.enum(RUN_STATUSES);
export const suiteStatusSchema = z.enum(SUITE_STATUSES);
export const suiteOrderStrategySchema = z.enum(SUITE_ORDER_STRATEGIES);
export const capabilityFlagSchema = z.enum(CAPABILITY_FLAGS);

export const scenarioCapabilitiesSchema = z
  .object({
    supported: z.boolean(),
    persistence: z.boolean(),
    acknowledgements: z.boolean(),
    consumerRecovery: z.boolean(),
    replay: z.boolean(),
    notes: z.array(z.string().min(1)),
  })
  .strict();

export const brokerCapabilitiesSchema = z
  .object({
    'fan-out': scenarioCapabilitiesSchema,
    'competing-consumers': scenarioCapabilitiesSchema,
  })
  .strict();

const finiteNonNegativeNumberSchema = z.number().finite().nonnegative();
const nonNegativeIntegerSchema = z.number().int().nonnegative();

export const latencyMetricsSchema = z
  .object({
    p50Ms: finiteNonNegativeNumberSchema,
    p95Ms: finiteNonNegativeNumberSchema,
    p99Ms: finiteNonNegativeNumberSchema,
  })
  .strict();

export const benchmarkMetricsSchema = z
  .object({
    elapsedMs: finiteNonNegativeNumberSchema,
    throughputMessagesPerSecond: finiteNonNegativeNumberSchema,
    latency: latencyMetricsSchema,
    publishedMessages: nonNegativeIntegerSchema,
    receivedMessages: nonNegativeIntegerSchema,
    lostMessages: nonNegativeIntegerSchema,
    duplicateMessages: nonNegativeIntegerSchema,
    errorCount: nonNegativeIntegerSchema,
  })
  .strict()
  .superRefine(({ latency }, context) => {
    if (latency.p50Ms > latency.p95Ms || latency.p95Ms > latency.p99Ms) {
      context.addIssue({
        code: 'custom',
        message: 'Latency percentiles must satisfy p50 <= p95 <= p99.',
        path: ['latency'],
      });
    }
  });

export type BrokerId = z.infer<typeof brokerIdSchema>;
export type ScenarioId = z.infer<typeof scenarioIdSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type SuiteStatus = z.infer<typeof suiteStatusSchema>;
export type SuiteOrderStrategy = z.infer<typeof suiteOrderStrategySchema>;
export type CapabilityFlag = z.infer<typeof capabilityFlagSchema>;
export type ScenarioCapabilities = z.infer<typeof scenarioCapabilitiesSchema>;
export type BrokerCapabilities = z.infer<typeof brokerCapabilitiesSchema>;
export type LatencyMetrics = z.infer<typeof latencyMetricsSchema>;
export type BenchmarkMetrics = z.infer<typeof benchmarkMetricsSchema>;
