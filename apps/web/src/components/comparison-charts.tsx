import type { BrokerId, Run, ScenarioId } from '@messaging-lab/shared';

import { BROKER_LABELS, formatNumber } from '../format.js';

export function ComparisonCharts({ runs }: { readonly runs: Run[] }) {
  const latest = latestCompletedRuns(runs);
  if (latest.size === 0) {
    return (
      <section className="section-block" aria-labelledby="comparison-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Separated by semantics</p>
            <h2 id="comparison-heading">Performance results</h2>
          </div>
        </div>
        <div className="empty-row">
          <strong>No comparable results yet.</strong>
          <span>Complete at least one experiment to populate the charts.</span>
        </div>
      </section>
    );
  }

  const pubSub = latest.get(runKey('redis', 'fan-out'));
  const durableFanOut = compact([
    latest.get(runKey('kafka', 'fan-out')),
    latest.get(runKey('rabbitmq', 'fan-out')),
  ]);
  const competingConsumers = compact([
    latest.get(runKey('redis', 'competing-consumers')),
    latest.get(runKey('kafka', 'competing-consumers')),
    latest.get(runKey('rabbitmq', 'competing-consumers')),
  ]);

  return (
    <>
      <section className="section-block" aria-labelledby="comparison-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Comparable workloads</p>
            <h2 id="comparison-heading">Durable performance comparisons</h2>
          </div>
          <p>
            Latest result per broker and pattern. Delivery models remain
            separated so unlike guarantees are not ranked together.
          </p>
        </div>
        <ComparisonGroup
          label="Durable fan-out comparison"
          title="Durable fan-out"
          description="Kafka and RabbitMQ deliver to independent durable subscribers. Kafka supports retained-log replay; RabbitMQ does not."
          runs={durableFanOut}
        />
        <ComparisonGroup
          label="Durable competing-consumer comparison"
          title="Durable competing consumers"
          description="Redis Streams, Kafka, and RabbitMQ distribute acknowledged work. Replay and retention behavior still differ."
          runs={competingConsumers}
        />
      </section>

      <section className="section-block" aria-labelledby="pubsub-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Not a durable comparison</p>
            <h2 id="pubsub-heading">Redis Pub/Sub live baseline</h2>
          </div>
        </div>
        <article className="baseline-card" aria-label="Ephemeral live baseline">
          <div className="baseline-copy">
            <span className="comparison-kind">Ephemeral delivery</span>
            <h3>Redis Pub/Sub</h3>
            <p>
              Useful for live notifications, but it has no persistence,
              acknowledgements, recovery, or replay. Its performance is shown as
              context and excluded from the durable comparisons above.
            </p>
          </div>
          {pubSub?.metrics ? (
            <div className="baseline-metrics">
              <ResultMetric
                label="Throughput"
                value={`${formatNumber(pubSub.metrics.throughputMessagesPerSecond, 2)} msg/s`}
              />
              <ResultMetric
                label="p95 latency"
                value={`${formatNumber(pubSub.metrics.latency.p95Ms, 2)} ms`}
              />
            </div>
          ) : (
            <span className="comparison-empty">
              No Redis Pub/Sub result yet
            </span>
          )}
        </article>
      </section>
    </>
  );
}

function ComparisonGroup({
  label,
  title,
  description,
  runs,
}: {
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly runs: Run[];
}) {
  return (
    <article className="comparison-group" aria-label={label}>
      <div className="comparison-group-heading">
        <div>
          <span className="comparison-kind">Comparable workload</span>
          <h3>{title}</h3>
        </div>
        <p>{description}</p>
      </div>
      {runs.length > 0 ? (
        <div className="chart-grid">
          <BarChart
            title="Throughput"
            unit="msg/s"
            runs={runs}
            value={(run) => run.metrics?.throughputMessagesPerSecond ?? 0}
          />
          <BarChart
            title="p95 latency"
            unit="ms"
            runs={runs}
            value={(run) => run.metrics?.latency.p95Ms ?? 0}
            lowerIsBetter
          />
        </div>
      ) : (
        <div className="comparison-empty">No results for this group yet.</div>
      )}
    </article>
  );
}

interface BarChartProps {
  readonly title: string;
  readonly unit: string;
  readonly runs: Run[];
  readonly value: (run: Run) => number;
  readonly lowerIsBetter?: boolean;
}

function BarChart({
  title,
  unit,
  runs,
  value,
  lowerIsBetter = false,
}: BarChartProps) {
  const maximum = Math.max(...runs.map(value), 1);
  return (
    <figure className="bar-chart" aria-label={`${title} comparison chart`}>
      <figcaption>
        <strong>{title}</strong>
        <span>{lowerIsBetter ? 'Lower is better' : 'Higher is better'}</span>
      </figcaption>
      <div className="bars">
        {runs.map((run) => {
          const amount = value(run);
          return (
            <div className="bar-row" key={`${title}-${run.id}`}>
              <span>{BROKER_LABELS[run.configuration.broker]}</span>
              <div className="bar-track">
                <span
                  className={`bar-fill broker-fill-${run.configuration.broker}`}
                  style={{ width: `${Math.max(2, (amount / maximum) * 100)}%` }}
                />
              </div>
              <strong>
                {formatNumber(amount, 2)} {unit}
              </strong>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

function ResultMetric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function latestCompletedRuns(runs: readonly Run[]): Map<string, Run> {
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

function runKey(broker: BrokerId, scenario: ScenarioId): string {
  return `${broker}:${scenario}`;
}

function compact(values: Array<Run | undefined>): Run[] {
  return values.filter((run): run is Run => Boolean(run));
}
