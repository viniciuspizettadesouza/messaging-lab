import {
  comparisonTrackFor,
  DistributionSummary,
  RunStatus,
  SuiteCombination,
  SuiteCombinationSummary,
  SuiteRun,
} from '@messaging-lab/shared';

const TERMINAL_UNSUCCESSFUL = new Set<RunStatus>([
  'failed',
  'timed-out',
  'cancelled',
]);

export function summarizeSuiteCombinations(
  combinations: readonly SuiteCombination[],
  runs: readonly SuiteRun[],
): SuiteCombinationSummary[] {
  return combinations.flatMap((combination, combinationIndex) => {
    const sweepPoints = [
      ...new Map(
        runs
          .filter((trial) => trial.combinationIndex === combinationIndex)
          .map((trial) => [trial.sweepPointIndex, trial.sweepValue] as const),
      ).entries(),
    ];
    return sweepPoints.map(([sweepPointIndex, sweepValue]) => {
      const trials = runs.filter(
        (trial) =>
          trial.combinationIndex === combinationIndex &&
          trial.sweepPointIndex === sweepPointIndex,
      );
      const successful = trials.filter(
        (trial) => trial.run?.status === 'completed' && trial.run.metrics,
      );
      const metrics = successful.flatMap((trial) =>
        trial.run?.metrics ? [trial.run.metrics] : [],
      );
      const count = (status: RunStatus) =>
        trials.filter((trial) => (trial.run?.status ?? 'pending') === status)
          .length;

      return {
        combinationIndex,
        combination,
        sweepPointIndex,
        sweepValue,
        comparisonTrack: comparisonTrackFor(
          combination.broker,
          combination.scenario,
        ),
        totalTrials: trials.length,
        successfulTrials: successful.length,
        unsuccessfulTrials: trials.filter(
          (trial) =>
            trial.run &&
            (TERMINAL_UNSUCCESSFUL.has(trial.run.status) ||
              (trial.run.status === 'completed' && !trial.run.metrics)),
        ).length,
        statusCounts: {
          pending: count('pending'),
          running: count('running'),
          completed: count('completed'),
          failed: count('failed'),
          timedOut: count('timed-out'),
          cancelled: count('cancelled'),
        },
        throughput: summarizeDistribution(
          metrics.map(
            ({ throughputMessagesPerSecond }) => throughputMessagesPerSecond,
          ),
        ),
        latency: {
          p50Ms: summarizeDistribution(
            metrics.map(({ latency }) => latency.p50Ms),
          ),
          p95Ms: summarizeDistribution(
            metrics.map(({ latency }) => latency.p95Ms),
          ),
          p99Ms: summarizeDistribution(
            metrics.map(({ latency }) => latency.p99Ms),
          ),
        },
        backlog: {
          maximumObservedMessages: summarizeDistribution(
            metrics.map(({ backlog }) => backlog.maximumObservedMessages),
          ),
        },
        totals: {
          publishedMessages: sum(
            metrics.map(({ publishedMessages }) => publishedMessages),
          ),
          receivedMessages: sum(
            metrics.map(({ receivedMessages }) => receivedMessages),
          ),
          lostMessages: sum(metrics.map(({ lostMessages }) => lostMessages)),
          duplicateMessages: sum(
            metrics.map(({ duplicateMessages }) => duplicateMessages),
          ),
          // Redelivery tracking is introduced by the recovery experiments. The
          // current performance workloads cannot produce a redelivery count.
          redeliveredMessages: 0,
          globalOrderingViolations: sum(
            metrics.map(({ ordering }) => ordering.globalViolations),
          ),
          nativeScopeOrderingViolations: sum(
            metrics.map(({ ordering }) => ordering.nativeScopeViolations),
          ),
          errors:
            sum(metrics.map(({ errorCount }) => errorCount)) +
            sum(trials.map((trial) => trial.run?.errors.length ?? 0)),
        },
      };
    });
  });
}

export function summarizeDistribution(
  values: readonly number[],
): DistributionSummary | null {
  const sorted = values
    .filter(Number.isFinite)
    .toSorted((left, right) => left - right);
  if (sorted.length === 0) return null;
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  return {
    sampleSize: sorted.length,
    minimum: sorted[0]!,
    q1,
    median: quantile(sorted, 0.5),
    q3,
    maximum: sorted.at(-1)!,
    interquartileRange: q3 - q1,
  };
}

function quantile(sorted: readonly number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  const lowerValue = sorted[lower]!;
  const upperValue = sorted[Math.ceil(position)]!;
  return lowerValue + (upperValue - lowerValue) * fraction;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
