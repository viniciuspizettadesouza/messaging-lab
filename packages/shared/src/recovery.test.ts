import { describe, expect, it } from 'vitest';

import {
  RECOVERY_EXPERIMENT_TYPES,
  recoveryExperimentDefinitions,
  recoveryExperimentRequestSchema,
  recoveryExperimentResultSchema,
} from './recovery.js';

describe('recovery experiment contracts', () => {
  it('maps every native experiment to one broker mechanism', () => {
    expect(Object.keys(recoveryExperimentDefinitions)).toEqual([
      ...RECOVERY_EXPERIMENT_TYPES,
    ]);
    expect(
      recoveryExperimentDefinitions['redis-pubsub-offline-loss'],
    ).toMatchObject({ broker: 'redis', replaySupported: false });
    expect(
      recoveryExperimentDefinitions['kafka-offset-reset-replay'],
    ).toMatchObject({ broker: 'kafka', replaySupported: true });
  });

  it('requires a deterministic interruption before completion', () => {
    expect(
      recoveryExperimentRequestSchema.safeParse({
        type: 'rabbitmq-unacknowledged-redelivery',
        messageCount: 5,
        interruptAfterMessages: 5,
      }).success,
    ).toBe(false);
  });

  it('rejects a result that hides unsupported replay behavior', () => {
    const result = recoveryExperimentResultSchema.safeParse({
      id: '44444444-4444-4444-8444-444444444444',
      type: 'redis-pubsub-offline-loss',
      broker: 'redis',
      scenario: 'fan-out',
      status: 'completed',
      deterministicInterruption: { afterMessages: 2 },
      replay: { supported: false, attempted: false, explanation: '' },
      expectedBehavior: 'Offline messages are lost.',
      observedBehavior: 'Five messages were lost.',
      observations: {
        recoveryTimeMs: 1,
        publishedMessages: 5,
        receivedMessages: 0,
        redeliveredMessages: 0,
        duplicateMessages: 0,
        lostMessages: 5,
        errorCount: 0,
      },
      resourceCleanup: {
        attemptedResources: 1,
        removedResources: 1,
        failures: [],
      },
      errors: [],
      startedAt: '2026-08-28T12:00:00.000Z',
      finishedAt: '2026-08-28T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});
