import type {
  BrokerId,
  ComparisonTrackId,
  Run,
  ScenarioId,
} from '@messaging-lab/shared';

export interface ComparisonGroups {
  readonly primaryFanOut: Run[];
  readonly primaryCompetingConsumers: Run[];
  readonly adjacentStreaming: Run[];
  readonly ephemeralBaseline: Run[];
}

export function comparisonGroupFor(run: Run): ComparisonTrackId {
  return run.comparisonTrack;
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
    primaryFanOut: compact([
      latest.get(runKey('kafka', 'fan-out')),
      latest.get(runKey('rabbitmq', 'fan-out')),
    ]),
    primaryCompetingConsumers: compact([
      latest.get(runKey('kafka', 'competing-consumers')),
      latest.get(runKey('rabbitmq', 'competing-consumers')),
    ]),
    adjacentStreaming: compact([
      latest.get(runKey('redis', 'competing-consumers')),
    ]),
    ephemeralBaseline: compact([latest.get(runKey('redis', 'fan-out'))]),
  };
}

export function runKey(broker: BrokerId, scenario: ScenarioId): string {
  return `${broker}:${scenario}`;
}

function compact(values: Array<Run | undefined>): Run[] {
  return values.filter((run): run is Run => Boolean(run));
}
