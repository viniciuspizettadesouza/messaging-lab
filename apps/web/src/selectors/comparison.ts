import type { BrokerId, Run, ScenarioId } from '@messaging-lab/shared';

export type ComparisonGroupId =
  | 'ephemeral-live'
  | 'durable-fan-out'
  | 'durable-competing-consumers';

export interface ComparisonGroups {
  readonly ephemeralLive: Run[];
  readonly durableFanOut: Run[];
  readonly durableCompetingConsumers: Run[];
}

export function comparisonGroupFor(run: Run): ComparisonGroupId {
  if (
    run.configuration.broker === 'redis' &&
    run.configuration.scenario === 'fan-out'
  ) {
    return 'ephemeral-live';
  }
  return run.configuration.scenario === 'fan-out'
    ? 'durable-fan-out'
    : 'durable-competing-consumers';
}

export function latestCompletedRuns(runs: readonly Run[]): Map<string, Run> {
  const latest = new Map<string, Run>();
  const newestFirst = [...runs].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );

  for (const run of newestFirst) {
    if (run.status !== 'completed' || !run.metrics) continue;
    const key = runKey(run.configuration.broker, run.configuration.scenario);
    if (!latest.has(key)) latest.set(key, run);
  }
  return latest;
}

export function selectComparisonGroups(runs: readonly Run[]): ComparisonGroups {
  const latest = latestCompletedRuns(runs);
  return {
    ephemeralLive: compact([latest.get(runKey('redis', 'fan-out'))]),
    durableFanOut: compact([
      latest.get(runKey('kafka', 'fan-out')),
      latest.get(runKey('rabbitmq', 'fan-out')),
    ]),
    durableCompetingConsumers: compact([
      latest.get(runKey('redis', 'competing-consumers')),
      latest.get(runKey('kafka', 'competing-consumers')),
      latest.get(runKey('rabbitmq', 'competing-consumers')),
    ]),
  };
}

export function runKey(broker: BrokerId, scenario: ScenarioId): string {
  return `${broker}:${scenario}`;
}

function compact(values: Array<Run | undefined>): Run[] {
  return values.filter((run): run is Run => Boolean(run));
}
