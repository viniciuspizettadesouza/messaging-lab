import type { Run } from '@messaging-lab/shared';

import { BROKER_LABELS, formatNumber } from '../format.js';
import { selectComparisonGroups } from '../selectors/comparison.js';

export function ComparisonCharts({ runs }: { readonly runs: Run[] }) {
  const groups = selectComparisonGroups(runs);
  const hasResults = Object.values(groups).some((group) => group.length > 0);
  if (!hasResults) {
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

  return (
    <>
      <section className="section-block" aria-labelledby="comparison-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Primary comparison track</p>
            <h2 id="comparison-heading">Kafka versus RabbitMQ</h2>
          </div>
          <p>
            The lab's retained-log architecture and queue/exchange architecture,
            shown only within matching workload patterns.
          </p>
        </div>
        <ComparisonGroup
          label="Primary fan-out comparison"
          title="Fan-out demonstrations"
          description="Kafka uses one retained topic with independent consumer groups; RabbitMQ uses one exchange and an independent queue per subscriber."
          runs={groups.primaryFanOut}
        />
        <ComparisonGroup
          label="Primary competing-consumer comparison"
          title="Competing-consumer demonstrations"
          description="Kafka parallelism is bounded by topic partitions. RabbitMQ dispatches queue deliveries across consumers with explicit acknowledgements."
          runs={groups.primaryCompetingConsumers}
        />
      </section>

      <section className="section-block" aria-labelledby="streams-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Adjacent streaming track</p>
            <h2 id="streams-heading">Redis Streams</h2>
          </div>
          <p>
            A retained-stream result with consumer-group pending-entry state,
            reported independently from the primary architectural comparison.
          </p>
        </div>
        <IndependentResult
          label="Adjacent Redis Streams result"
          kind="Independent stream summary"
          title="Redis Streams"
          description="An adjacent mechanism study, not a ranking against Kafka or RabbitMQ. The current adapters demonstrate different broker-native mechanisms."
          run={groups.adjacentStreaming[0]}
        />
      </section>

      <section className="section-block" aria-labelledby="pubsub-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Ephemeral baseline track</p>
            <h2 id="pubsub-heading">Redis Pub/Sub live baseline</h2>
          </div>
        </div>
        <IndependentResult
          label="Ephemeral live baseline"
          kind="Ephemeral delivery"
          title="Redis Pub/Sub"
          description="Useful for live notifications, but it has no persistence, acknowledgements, recovery, or replay. It is context only and never participates in durable-system rankings."
          run={groups.ephemeralBaseline[0]}
        />
      </section>
    </>
  );
}

function IndependentResult({
  label,
  kind,
  title,
  description,
  run,
}: {
  readonly label: string;
  readonly kind: string;
  readonly title: string;
  readonly description: string;
  readonly run: Run | undefined;
}) {
  return (
    <article className="baseline-card" aria-label={label}>
      <div className="baseline-copy">
        <span className="comparison-kind">{kind}</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {run?.metrics ? (
        <div className="baseline-metrics">
          <ResultMetric
            label="Throughput"
            value={`${formatNumber(run.metrics.throughputMessagesPerSecond, 2)} msg/s`}
          />
          <ResultMetric
            label="p95 latency"
            value={`${formatNumber(run.metrics.latency.p95Ms, 2)} ms`}
          />
        </div>
      ) : (
        <span className="comparison-empty">No {title} result yet</span>
      )}
    </article>
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
          <span className="comparison-kind">Primary track</span>
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

function BarChart({
  title,
  unit,
  runs,
  value,
  lowerIsBetter = false,
}: {
  readonly title: string;
  readonly unit: string;
  readonly runs: Run[];
  readonly value: (run: Run) => number;
  readonly lowerIsBetter?: boolean;
}) {
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
