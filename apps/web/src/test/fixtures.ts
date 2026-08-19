import {
  BENCHMARK_DEFAULTS,
  BROKER_CAPABILITIES,
  type BrokerInfo,
  type Run,
  type RunStatus,
  type Suite,
  type SuiteStatus,
} from '@messaging-lab/shared';

export const runId = '11111111-1111-4111-8111-111111111111';
export const timestamp = '2026-08-18T12:00:00.000Z';
export const suiteId = '22222222-2222-4222-8222-222222222222';

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

export function createSuite(
  status: SuiteStatus = 'pending',
  trialStatuses: RunStatus[] = [],
): Suite {
  const combinations = [
    { broker: 'redis', scenario: 'fan-out' },
    { broker: 'kafka', scenario: 'competing-consumers' },
  ] as const;
  const runs = combinations.map((combination, position) => {
    const runStatus = trialStatuses[position];
    return {
      position,
      combinationIndex: position,
      repetition: 1,
      combination,
      run: runStatus
        ? {
            ...createRun(runStatus),
            id: `11111111-1111-4111-8111-${String(position + 1).padStart(12, '0')}`,
            configuration: {
              ...createRun(runStatus).configuration,
              ...combination,
            },
          }
        : null,
    };
  });
  const counts = (runStatus: RunStatus) =>
    trialStatuses.filter((value) => value === runStatus).length;
  const terminal = trialStatuses.filter((value) =>
    ['completed', 'failed', 'timed-out', 'cancelled'].includes(value),
  ).length;
  const activePosition = trialStatuses.findIndex((value) =>
    ['pending', 'running'].includes(value),
  );

  return {
    id: suiteId,
    name: 'Test benchmark suite',
    status,
    configuration: {
      workload: { ...BENCHMARK_DEFAULTS, messageCount: 10 },
      combinations: [...combinations],
      repetitions: 1,
      orderStrategy: 'fixed',
      cooldownMs: 0,
    },
    progress: {
      completedRuns: terminal,
      totalRuns: runs.length,
      currentPosition: activePosition >= 0 ? activePosition : null,
      currentCombination:
        activePosition >= 0 ? combinations[activePosition]! : null,
      currentRepetition: activePosition >= 0 ? 1 : null,
      activeRunId: activePosition >= 0 ? runs[activePosition]!.run!.id : null,
    },
    summary: {
      totalRuns: runs.length,
      pendingRuns: runs.length - terminal - counts('running'),
      runningRuns: counts('running'),
      completedRuns: counts('completed'),
      failedRuns: counts('failed'),
      timedOutRuns: counts('timed-out'),
      cancelledRuns: counts('cancelled'),
    },
    createdAt: timestamp,
    startedAt: status === 'pending' ? null : timestamp,
    finishedAt: ['pending', 'running'].includes(status) ? null : timestamp,
    stopReason: status === 'stopped' ? 'The API restarted.' : null,
    errors: [],
    runs,
  };
}
