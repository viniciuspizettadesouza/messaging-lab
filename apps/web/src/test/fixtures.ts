import {
  BENCHMARK_DEFAULTS,
  BROKER_CAPABILITIES,
  type BrokerInfo,
  type Run,
  type RunStatus,
} from '@messaging-lab/shared';

export const runId = '11111111-1111-4111-8111-111111111111';
export const timestamp = '2026-08-18T12:00:00.000Z';

export const brokers: BrokerInfo[] = (
  ['redis', 'kafka', 'rabbitmq'] as const
).map((id) => ({
  id,
  capabilities: BROKER_CAPABILITIES[id],
  health: {
    status: 'healthy',
    latencyMs: 1,
    checkedAt: timestamp,
    error: null,
  },
}));

export function createRun(status: RunStatus = 'pending'): Run {
  return {
    id: runId,
    configuration: {
      broker: 'redis',
      scenario: 'fan-out',
      ...BENCHMARK_DEFAULTS,
      messageCount: 10,
    },
    status,
    createdAt: timestamp,
    startedAt: status === 'pending' ? null : timestamp,
    finishedAt: ['pending', 'running'].includes(status) ? null : timestamp,
    metrics:
      status === 'completed'
        ? {
            elapsedMs: 20,
            throughputMessagesPerSecond: 500,
            latency: { p50Ms: 1, p95Ms: 2, p99Ms: 3 },
            publishedMessages: 10,
            receivedMessages: 10,
            lostMessages: 0,
            duplicateMessages: 0,
            errorCount: 0,
          }
        : null,
    notes: ['Redis Pub/Sub delivers only to connected subscribers.'],
    errors:
      status === 'failed'
        ? [
            {
              code: 'RUN_FAILED',
              message: 'Broker unavailable.',
              occurredAt: timestamp,
            },
          ]
        : [],
  };
}
