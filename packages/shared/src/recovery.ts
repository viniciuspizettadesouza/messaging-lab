import { z } from 'zod';

import { brokerIdSchema, scenarioIdSchema } from './domain.js';

export const RECOVERY_EXPERIMENT_TYPES = [
  'redis-streams-pending-recovery',
  'redis-streams-retained-replay',
  'kafka-committed-offset-recovery',
  'kafka-offset-reset-replay',
  'rabbitmq-unacknowledged-redelivery',
  'redis-pubsub-offline-loss',
] as const;

export const recoveryExperimentTypeSchema = z.enum(RECOVERY_EXPERIMENT_TYPES);

export const recoveryExperimentDefinitions = {
  'redis-streams-pending-recovery': {
    broker: 'redis',
    scenario: 'competing-consumers',
    label: 'Redis Streams pending-message recovery',
    expectedBehavior:
      'An application-claimed pending entry is delivered to the replacement consumer and acknowledged.',
    replaySupported: true,
  },
  'redis-streams-retained-replay': {
    broker: 'redis',
    scenario: 'competing-consumers',
    label: 'Redis Streams retained-message replay',
    expectedBehavior:
      'Entries retained in the stream remain readable from the beginning after the original delivery window.',
    replaySupported: true,
  },
  'kafka-committed-offset-recovery': {
    broker: 'kafka',
    scenario: 'competing-consumers',
    label: 'Kafka committed-offset recovery',
    expectedBehavior:
      "A replacement consumer resumes from the group's last committed offset, so the interrupted uncommitted record is delivered again.",
    replaySupported: true,
  },
  'kafka-offset-reset-replay': {
    broker: 'kafka',
    scenario: 'competing-consumers',
    label: 'Kafka explicit offset-reset replay',
    expectedBehavior:
      'Resetting the consumer group to the earliest offsets makes retained records available again.',
    replaySupported: true,
  },
  'rabbitmq-unacknowledged-redelivery': {
    broker: 'rabbitmq',
    scenario: 'competing-consumers',
    label: 'RabbitMQ unacknowledged-message redelivery',
    expectedBehavior:
      'Closing the interrupted consumer channel requeues its unacknowledged delivery for a replacement consumer.',
    replaySupported: false,
  },
  'redis-pubsub-offline-loss': {
    broker: 'redis',
    scenario: 'fan-out',
    label: 'Redis Pub/Sub disconnected-subscriber loss',
    expectedBehavior:
      'Messages published with no connected subscriber are not retained and cannot be replayed.',
    replaySupported: false,
  },
} as const satisfies Record<
  z.infer<typeof recoveryExperimentTypeSchema>,
  {
    broker: z.infer<typeof brokerIdSchema>;
    scenario: z.infer<typeof scenarioIdSchema>;
    label: string;
    expectedBehavior: string;
    replaySupported: boolean;
  }
>;

export const recoveryExperimentRequestSchema = z
  .object({
    type: recoveryExperimentTypeSchema,
    messageCount: z.number().int().min(2).max(100).default(5),
    interruptAfterMessages: z.number().int().min(1).default(2),
    timeoutMs: z.number().int().min(1_000).max(60_000).default(15_000),
  })
  .strict()
  .superRefine(({ messageCount, interruptAfterMessages }, context) => {
    if (interruptAfterMessages >= messageCount) {
      context.addIssue({
        code: 'custom',
        message: 'Interruption must occur before the final message.',
        path: ['interruptAfterMessages'],
      });
    }
  });

export const recoveryObservationSchema = z
  .object({
    recoveryTimeMs: z.number().finite().nonnegative().nullable(),
    publishedMessages: z.number().int().nonnegative(),
    receivedMessages: z.number().int().nonnegative(),
    redeliveredMessages: z.number().int().nonnegative(),
    duplicateMessages: z.number().int().nonnegative(),
    lostMessages: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
  })
  .strict();

export const recoveryExperimentResultSchema = z
  .object({
    id: z.uuid(),
    type: recoveryExperimentTypeSchema,
    broker: brokerIdSchema,
    scenario: scenarioIdSchema,
    status: z.enum(['completed', 'failed', 'timed-out', 'cancelled']),
    deterministicInterruption: z
      .object({ afterMessages: z.number().int().positive() })
      .strict(),
    replay: z
      .object({
        supported: z.boolean(),
        attempted: z.boolean(),
        explanation: z.string().min(1),
      })
      .strict(),
    expectedBehavior: z.string().min(1),
    observedBehavior: z.string().min(1),
    observations: recoveryObservationSchema,
    resourceCleanup: z
      .object({
        attemptedResources: z.number().int().nonnegative(),
        removedResources: z.number().int().nonnegative(),
        failures: z.array(
          z.object({ resource: z.string(), message: z.string() }).strict(),
        ),
      })
      .strict(),
    errors: z.array(z.string().min(1)),
    startedAt: z.string().datetime({ offset: true }),
    finishedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type RecoveryExperimentType = z.infer<
  typeof recoveryExperimentTypeSchema
>;
export type RecoveryExperimentRequest = z.input<
  typeof recoveryExperimentRequestSchema
>;
export type ResolvedRecoveryExperimentRequest = z.output<
  typeof recoveryExperimentRequestSchema
>;
export type RecoveryExperimentResult = z.infer<
  typeof recoveryExperimentResultSchema
>;
