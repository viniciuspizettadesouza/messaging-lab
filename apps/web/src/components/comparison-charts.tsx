import type { Run } from '@messaging-lab/shared';

import { BROKER_LABELS, formatNumber } from '../format.js';

export function ComparisonCharts({ runs }: { readonly runs: Run[] }) {
  const completed = runs.filter((run) => run.metrics).slice(0, 8);
  if (completed.length === 0) {
    return (
      <section className="section-block" aria-labelledby="comparison-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Side by side</p>
            <h2 id="comparison-heading">Performance comparison</h2>
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
    <section className="section-block" aria-labelledby="comparison-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Side by side</p>
          <h2 id="comparison-heading">Performance comparison</h2>
        </div>
        <p>
          Latest completed runs; host conditions and delivery semantics affect
          results.
        </p>
      </div>
      <div className="chart-grid">
        <BarChart
          title="Throughput"
          unit="msg/s"
          runs={completed}
          value={(run) => run.metrics?.throughputMessagesPerSecond ?? 0}
        />
        <BarChart
          title="p95 latency"
          unit="ms"
          runs={completed}
          value={(run) => run.metrics?.latency.p95Ms ?? 0}
          lowerIsBetter
        />
      </div>
    </section>
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
