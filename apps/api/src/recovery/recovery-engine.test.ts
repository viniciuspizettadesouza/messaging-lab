import { describe, expect, it } from 'vitest';

import {
  BROKER_CAPABILITIES,
  RECOVERY_EXPERIMENT_TYPES,
  type BrokerAdapter,
  type BrokerRunContext,
  type BrokerRunResource,
  type DeliveryHandler,
  type OutboundMessage,
  type RecoveryExperimentType,
} from '@messaging-lab/shared';

import { RecoveryExperimentEngine } from './recovery-engine.js';

describe('RecoveryExperimentEngine', () => {
  it.each(RECOVERY_EXPERIMENT_TYPES)(
    'executes %s and always reports cleanup',
    async (type) => {
      const adapter = new RecoveryFakeAdapter();
      const result = await engine(adapter).execute(request(type));

      expect(result.status).toBe('completed');
      expect(result.deterministicInterruption.afterMessages).toBe(2);
      expect(result.observations.errorCount).toBe(0);
      expect(result.resourceCleanup).toEqual({
        attemptedResources: 1,
        removedResources: 1,
        failures: [],
      });
      expect(adapter.cleanupCalls).toBe(1);

      if (type === 'redis-pubsub-offline-loss') {
        expect(result.observations).toMatchObject({
          lostMessages: 5,
          receivedMessages: 0,
        });
        expect(result.replay).toMatchObject({
          supported: false,
          attempted: false,
        });
      } else {
        expect(result.observations.lostMessages).toBe(0);
      }
    },
  );

  it('cleans partially created resources after cancellation', async () => {
    const adapter = new RecoveryFakeAdapter(true);
    const controller = new AbortController();
    const execution = engine(adapter).execute(
      request('redis-streams-retained-replay'),
      controller.signal,
    );
    controller.abort(new Error('cancelled by test'));

    const result = await execution;
    expect(result.status).toBe('cancelled');
    expect(result.errors).toContain('cancelled by test');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(adapter.cleanupCalls).toBe(1);
  });

  it('cleans late resources after a timeout', async () => {
    const adapter = new RecoveryFakeAdapter(true);
    const result = await engine(adapter).execute({
      ...request('redis-streams-retained-replay'),
      timeoutMs: 1,
    });

    expect(result.status).toBe('timed-out');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(adapter.cleanupCalls).toBe(1);
  });

  it('cleans resources after an adapter failure', async () => {
    const adapter = new RecoveryFakeAdapter(false, true);
    const result = await engine(adapter).execute(
      request('redis-streams-retained-replay'),
    );

    expect(result.status).toBe('failed');
    expect(result.errors).toContain('replay failed');
    expect(adapter.cleanupCalls).toBe(1);
  });
});

function request(type: RecoveryExperimentType) {
  return { type, messageCount: 5, interruptAfterMessages: 2, timeoutMs: 1_000 };
}

function engine(adapter: BrokerAdapter): RecoveryExperimentEngine {
  return new RecoveryExperimentEngine({
    redis: adapter,
    kafka: adapter,
    rabbitmq: adapter,
  });
}

class RecoveryFakeAdapter implements BrokerAdapter {
  public readonly id = 'redis' as const;
  public readonly capabilities = BROKER_CAPABILITIES.redis;
  public cleanupCalls = 0;

  public constructor(
    private readonly delayedCreation = false,
    private readonly failReplay = false,
  ) {}

  public async checkHealth() {
    return {
      status: 'healthy' as const,
      latencyMs: 0,
      checkedAt: new Date().toISOString(),
      error: null,
    };
  }

  public async createRun(
    context: BrokerRunContext,
  ): Promise<BrokerRunResource> {
    if (this.delayedCreation) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const published: OutboundMessage[] = [];
    let handler: DeliveryHandler | undefined;
    return {
      resourceNames: ['fake-resource'],
      startConsumers: async (nextHandler) => {
        handler = nextHandler;
        if (context.scenario !== 'fan-out') {
          for (const item of published) {
            await handler({
              ...item,
              consumerId: 'fake-consumer',
              nativeOrderScope: 'fake:scope',
            });
          }
        }
      },
      publish: async (item) => {
        published.push(item);
        if (handler)
          await handler({
            ...item,
            consumerId: 'fake-consumer',
            nativeOrderScope: 'fake:scope',
          });
      },
      replay: async (onDelivery) => {
        if (this.failReplay) throw new Error('replay failed');
        for (const item of published) {
          await onDelivery({
            ...item,
            consumerId: 'fake-replay',
            nativeOrderScope: 'fake:scope',
          });
        }
      },
      resetReplay: async (onDelivery) => {
        for (const item of published) {
          await onDelivery({
            ...item,
            consumerId: 'fake-offset-reset',
            nativeOrderScope: 'fake:scope',
          });
        }
      },
      demonstrateRecovery: async (item, onDelivery) => {
        await onDelivery({
          ...item,
          consumerId: 'fake-recovered',
          nativeOrderScope: 'fake:scope',
        });
      },
      cleanup: async () => {
        this.cleanupCalls += 1;
        return {
          attemptedResources: 1,
          removedResources: 1,
          failures: [],
        };
      },
    };
  }
}
