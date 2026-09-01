import type {
  DistributionSummary,
  Run,
  Suite,
  SuiteCombinationSummary,
  SweepParameter,
} from '@messaging-lab/shared';

import {
  BROKER_LABELS,
  COMPARISON_TRACK_LABELS,
  SCENARIO_LABELS,
  formatDate,
  formatNumber,
} from '../format.js';
import { StatusBadge } from './status-badge.js';
import { selectSweepCurveSummaries } from '../selectors/comparison.js';

interface SuiteDetailProps {
  readonly suite: Suite;
  readonly disconnected: boolean;
  readonly onCancel: () => Promise<void>;
  readonly onSelectRun: (run: Run) => void;
  readonly onDelete: () => Promise<void>;
}

export function SuiteDetail({
  suite,
  disconnected,
  onCancel,
  onSelectRun,
  onDelete,
}: SuiteDetailProps) {
  const active = suite.status === 'pending' || suite.status === 'running';
  const completed = suite.progress.completedRuns;
  const total = suite.progress.totalRuns;
  const percent = Math.round((completed / total) * 100);
  const current = suite.progress.currentCombination;
  const currentLabel = current
    ? `${BROKER_LABELS[current.broker]} · ${SCENARIO_LABELS[current.scenario]}`
    : active
      ? 'Preparing the next trial'
      : 'No active trial';

  return (
    <section
      className="detail-panel suite-detail"
      aria-labelledby="suite-detail-heading"
    >
      <div className="run-detail-header">
        <div>
          <p className="eyebrow">Suite {suite.id.slice(0, 8)}</p>
          <h2 id="suite-detail-heading">{suite.name}</h2>
          <p className="muted">Created {formatDate(suite.createdAt)}</p>
          {suite.description ? <p>{suite.description}</p> : null}
        </div>
        <StatusBadge status={suite.status} />
      </div>

      {disconnected && active ? (
        <div className="state-notice warning" role="alert">
          <strong>Live suite connection lost</strong>
          <span>
            The server-managed suite is still running. Reload to reconnect.
          </span>
        </div>
      ) : null}
      {!active ? (
        <button
          className="danger-button history-delete"
          type="button"
          onClick={() => void onDelete()}
        >
          Delete suite
        </button>
      ) : null}

      <div
        className="live-progress suite-progress"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="progress-label">
          <span>{currentLabel}</span>
          <strong>{percent}%</strong>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-label="Overall suite progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
          aria-valuetext={`${completed} of ${total} runs finished`}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="progress-counts">
          <span>
            {completed}/{total} finished
          </span>
          <span>{total - completed} remaining</span>
        </div>
        {suite.progress.currentRepetition ? (
          <p className="current-repetition">
            Repetition {suite.progress.currentRepetition} of{' '}
            {suite.configuration.repetitions}
            {suite.progress.currentSweepValue !== null &&
            suite.progress.currentSweepValue !== undefined &&
            suite.configuration.sweep
              ? ` · ${sweepLabel(suite.configuration.sweep.parameter)} ${suite.progress.currentSweepValue}`
              : ''}
          </p>
        ) : null}
        {active ? (
          <button
            className="danger-button"
            type="button"
            onClick={() => void onCancel()}
          >
            Cancel suite
          </button>
        ) : null}
      </div>

      <div className="suite-summary" aria-label="Suite trial summary">
        <Summary label="Completed" value={suite.summary.completedRuns} />
        <Summary label="Failed" value={suite.summary.failedRuns} alert />
        <Summary label="Timed out" value={suite.summary.timedOutRuns} alert />
        <Summary label="Cancelled" value={suite.summary.cancelledRuns} alert />
        <Summary label="Queued" value={suite.summary.pendingRuns} />
      </div>

      <div className="suite-exports" aria-label="Suite exports">
        <a href={`/api/suites/${suite.id}/export?format=json`} download>
          Export JSON
        </a>
        <a href={`/api/suites/${suite.id}/export?format=csv`} download>
          Export CSV
        </a>
      </div>

      <Provenance suite={suite} />

      {suite.configuration.sweep ? <SweepCurves suite={suite} /> : null}

      {suite.stopReason ? (
        <div className="state-notice">
          <strong>{suite.stopReason}</strong>
        </div>
      ) : null}
      {suite.errors.length > 0 ? (
        <div className="errors-block" role="alert">
          <h3>Suite errors</h3>
          <ul>
            {suite.errors.map((error) => (
              <li key={`${error.code}-${error.occurredAt}`}>
                <strong>{error.code}</strong> {error.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="suite-aggregates">
        <h3>Repeated-trial distributions by comparison track</h3>
        <p className="muted aggregate-intro">
          Completed trials contribute to distributions. Failed, timed-out, and
          cancelled trials remain counted. Mixed-track suites schedule work
          together but never combine their aggregates or conclusions.
        </p>
        {suite.comparisonTracks.map((track) => (
          <section key={track} aria-label={COMPARISON_TRACK_LABELS[track]}>
            <h4>{COMPARISON_TRACK_LABELS[track]}</h4>
            {suite.combinationSummaries
              .filter((summary) => summary.comparisonTrack === track)
              .map((summary) => (
                <CombinationAggregate
                  key={summary.combinationIndex}
                  summary={summary}
                />
              ))}
          </section>
        ))}
      </div>

      <div className="suite-trials">
        <h3>Execution order</h3>
        <ol>
          {suite.runs.map((item) => (
            <li key={item.position}>
              <span>
                <strong>{BROKER_LABELS[item.combination.broker]}</strong>
                {' · '}
                {SCENARIO_LABELS[item.combination.scenario]}
                {' · '}repetition {item.repetition}
                {item.run?.errors[0] ? (
                  <small className="trial-error">
                    {item.run.errors[0].message}
                  </small>
                ) : null}
              </span>
              {item.run ? (
                <button
                  type="button"
                  className="table-link"
                  onClick={() => onSelectRun(item.run!)}
                >
                  <StatusBadge status={item.run.status} />
                  <span className="visually-hidden">View run</span>
                </button>
              ) : (
                <span className="queued-label">Queued</span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Provenance({ suite }: { readonly suite: Suite }) {
  const environment = suite.environment;
  return (
    <details className="suite-provenance">
      <summary>Environment and reproducibility</summary>
      <div className="provenance-content">
        <h3>Resolved workload</h3>
        <dl className="provenance-grid">
          <Definition
            label="Messages"
            value={suite.configuration.workload.messageCount}
          />
          <Definition
            label="Payload bytes"
            value={suite.configuration.workload.payloadSizeBytes}
          />
          <Definition
            label="Producers"
            value={suite.configuration.workload.producerConcurrency}
          />
          <Definition
            label="Consumers"
            value={suite.configuration.workload.consumerCount}
          />
          <Definition
            label="Consumer delay"
            value={`${suite.configuration.workload.consumerDelayMs} ms`}
          />
          <Definition
            label="Timeout"
            value={`${suite.configuration.workload.timeoutMs} ms`}
          />
          <Definition
            label="Repetitions"
            value={suite.configuration.repetitions}
          />
          <Definition label="Order" value={suite.configuration.orderStrategy} />
          <Definition
            label="Cooldown"
            value={`${suite.configuration.cooldownMs} ms`}
          />
          {suite.configuration.sweep ? (
            <Definition
              label="Sweep"
              value={`${sweepLabel(suite.configuration.sweep.parameter)}: ${suite.configuration.sweep.values.join(', ')}`}
            />
          ) : null}
        </dl>
        {!environment ? (
          <p className="muted provenance-unavailable">
            Environment provenance was not recorded for this legacy suite.
          </p>
        ) : (
          <>
            <h3>Host and runtime</h3>
            <dl className="provenance-grid">
              <Definition
                label="Application"
                value={environment.application.version}
              />
              <Definition
                label="Commit"
                value={environment.application.commit ?? 'Not available'}
              />
              <Definition
                label="Node.js"
                value={environment.runtime.nodeVersion}
              />
              <Definition
                label="Operating system"
                value={`${environment.host.platform} ${environment.host.release}`}
              />
              <Definition
                label="Architecture"
                value={environment.host.architecture}
              />
              <Definition
                label="Logical CPUs"
                value={environment.host.logicalCpuCount}
              />
              <Definition
                label="Memory"
                value={
                  environment.host.totalMemoryBytes
                    ? formatBytes(environment.host.totalMemoryBytes)
                    : 'Not available'
                }
              />
              <Definition
                label="Captured"
                value={formatDate(environment.capturedAt)}
              />
            </dl>
            <h3>Broker and adapter versions</h3>
            <ul className="provenance-brokers">
              {[
                ...new Set(
                  suite.configuration.combinations.map(({ broker }) => broker),
                ),
              ].map((broker) => {
                const brokerEnvironment = environment.brokers[broker];
                const adapter = environment.adapterConfiguration[broker];
                return (
                  <li key={broker}>
                    <strong>{BROKER_LABELS[broker]}</strong>
                    <span>
                      {brokerEnvironment.image ?? 'Image not available'}
                    </span>
                    <small>
                      broker {brokerEnvironment.version ?? 'unknown'} ·{' '}
                      {adapter.client} · {adapter.transport}
                    </small>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </details>
  );
}

function Definition({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | number;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatBytes(bytes: number): string {
  return `${formatNumber(bytes / 1024 ** 3, 1)} GiB`;
}

function SweepCurves({ suite }: { readonly suite: Suite }) {
  const sweep = suite.configuration.sweep;
  if (!sweep) return null;
  return (
    <section className="sweep-curves" aria-labelledby="sweep-curves-heading">
      <h3 id="sweep-curves-heading">Parameter sweep curves</h3>
      <p className="muted">
        Median results by {sweepLabel(sweep.parameter).toLowerCase()}; each
        broker-native mechanism remains in its comparison track. Backlog is
        measured at the application boundary, not as interchangeable broker lag.
      </p>
      {suite.comparisonTracks.map((track) => (
        <section
          key={track}
          aria-label={`${COMPARISON_TRACK_LABELS[track]} curves`}
        >
          <h4>{COMPARISON_TRACK_LABELS[track]}</h4>
          {suite.configuration.combinations.map(
            (combination, combinationIndex) => {
              const points = selectSweepCurveSummaries(
                suite.combinationSummaries,
                track,
                combinationIndex,
              );
              if (points.length === 0) return null;
              const label = `${BROKER_LABELS[combination.broker]} · ${SCENARIO_LABELS[combination.scenario]}`;
              return (
                <article className="sweep-curve-group" key={combinationIndex}>
                  <h5>{label}</h5>
                  <div className="sweep-chart-grid">
                    <CurveChart
                      title="Median throughput"
                      unit="msg/s"
                      parameter={sweep.parameter}
                      points={points.map((point) => ({
                        x: point.sweepValue!,
                        y: point.throughput?.median ?? null,
                      }))}
                    />
                    <CurveChart
                      title="Median p95 latency"
                      unit="ms"
                      parameter={sweep.parameter}
                      points={points.map((point) => ({
                        x: point.sweepValue!,
                        y: point.latency.p95Ms?.median ?? null,
                      }))}
                    />
                    <CurveChart
                      title="Median observed backlog"
                      unit="deliveries"
                      parameter={sweep.parameter}
                      points={points.map((point) => ({
                        x: point.sweepValue!,
                        y:
                          point.backlog.maximumObservedMessages?.median ?? null,
                      }))}
                    />
                  </div>
                </article>
              );
            },
          )}
        </section>
      ))}
    </section>
  );
}

function CurveChart({
  title,
  unit,
  parameter,
  points,
}: {
  readonly title: string;
  readonly unit: string;
  readonly parameter: SweepParameter;
  readonly points: readonly { readonly x: number; readonly y: number | null }[];
}) {
  const measured = points.filter(
    (point): point is { x: number; y: number } => point.y !== null,
  );
  const maximum = Math.max(...measured.map(({ y }) => y), 1);
  const xMinimum = Math.min(...points.map(({ x }) => x));
  const xMaximum = Math.max(...points.map(({ x }) => x));
  const xPosition = (value: number) =>
    xMaximum === xMinimum
      ? 50
      : ((value - xMinimum) / (xMaximum - xMinimum)) * 92 + 4;
  const coordinates = measured
    .map(({ x, y }) => `${xPosition(x)},${54 - (y / maximum) * 48}`)
    .join(' ');
  return (
    <figure
      className="curve-chart"
      aria-label={`${title} by ${sweepLabel(parameter)}`}
    >
      <figcaption>
        <strong>{title}</strong>
        <span>{unit}</span>
      </figcaption>
      {measured.length === 0 ? (
        <p className="comparison-empty">No successful trials yet.</p>
      ) : (
        <svg
          viewBox="0 0 100 60"
          role="img"
          aria-label={measured
            .map(({ x, y }) => `${x}: ${formatNumber(y, 2)} ${unit}`)
            .join(', ')}
        >
          <line x1="4" y1="54" x2="96" y2="54" />
          <polyline points={coordinates} />
          {measured.map(({ x, y }) => (
            <circle
              key={x}
              cx={xPosition(x)}
              cy={54 - (y / maximum) * 48}
              r="2"
            />
          ))}
        </svg>
      )}
      <div
        className="curve-x-axis"
        aria-label={`${sweepLabel(parameter)} x-axis`}
      >
        {points.map(({ x }) => (
          <span key={x} style={{ left: `${xPosition(x)}%` }}>
            {formatNumber(x)}
          </span>
        ))}
      </div>
      <small>{sweepLabel(parameter)}</small>
    </figure>
  );
}

function sweepLabel(parameter: SweepParameter): string {
  return {
    consumerCount: 'Consumers',
    producerConcurrency: 'Producers',
    payloadSizeBytes: 'Payload bytes',
    messageCount: 'Messages',
    consumerDelayMs: 'Consumer delay (ms)',
  }[parameter];
}

function CombinationAggregate({
  summary,
}: {
  readonly summary: SuiteCombinationSummary;
}) {
  const label = `${BROKER_LABELS[summary.combination.broker]} · ${SCENARIO_LABELS[summary.combination.scenario]}`;
  const tooFew = summary.successfulTrials < 3;
  return (
    <article className="aggregate-card" aria-label={`${label} trial summary`}>
      <div className="aggregate-heading">
        <strong>
          {label}
          {summary.sweepValue !== null && summary.sweepValue !== undefined
            ? ` · sweep value ${formatNumber(summary.sweepValue)}`
            : ''}
        </strong>
        <span>
          {summary.successfulTrials} successful · {summary.unsuccessfulTrials}{' '}
          unsuccessful
        </span>
      </div>
      {tooFew ? (
        <p className="aggregate-warning" role="status">
          Too few successful trials for a useful distribution; run at least 3.
        </p>
      ) : null}
      <DistributionRow
        label="Throughput"
        distribution={summary.throughput}
        unit="msg/s"
      />
      <DistributionRow
        label="p50 latency"
        distribution={summary.latency.p50Ms}
        unit="ms"
      />
      <DistributionRow
        label="p95 latency"
        distribution={summary.latency.p95Ms}
        unit="ms"
      />
      <DistributionRow
        label="p99 latency"
        distribution={summary.latency.p99Ms}
        unit="ms"
      />
      <DistributionRow
        label="Maximum observed backlog"
        distribution={summary.backlog.maximumObservedMessages}
        unit="deliveries"
      />
      <dl className="aggregate-totals">
        <Total label="Lost" value={summary.totals.lostMessages} />
        <Total label="Duplicates" value={summary.totals.duplicateMessages} />
        <Total
          label="Global order violations"
          value={summary.totals.globalOrderingViolations}
        />
        <Total
          label="Native-scope order violations"
          value={summary.totals.nativeScopeOrderingViolations}
        />
        <Total
          label="Redeliveries"
          value={summary.totals.redeliveredMessages}
        />
        <Total label="Errors" value={summary.totals.errors} />
      </dl>
    </article>
  );
}

function DistributionRow({
  label,
  distribution,
  unit,
}: {
  readonly label: string;
  readonly distribution: DistributionSummary | null;
  readonly unit: string;
}) {
  if (!distribution) {
    return (
      <div className="distribution-row empty-distribution">
        <span>{label}</span>
        <strong>No successful trials</strong>
      </div>
    );
  }
  const range = distribution.maximum - distribution.minimum;
  const position = (value: number) =>
    range === 0 ? 50 : ((value - distribution.minimum) / range) * 100;
  const q1Position = position(distribution.q1);
  const q3Position = position(distribution.q3);
  return (
    <div className="distribution-row">
      <span>{label}</span>
      <div
        className="distribution-range"
        role="img"
        aria-label={`${label}: minimum ${formatNumber(distribution.minimum, 2)}, first quartile ${formatNumber(distribution.q1, 2)}, median ${formatNumber(distribution.median, 2)}, third quartile ${formatNumber(distribution.q3, 2)}, maximum ${formatNumber(distribution.maximum, 2)} ${unit}`}
      >
        <i className="distribution-whisker" />
        <i
          className="distribution-box"
          style={{
            left: `${q1Position}%`,
            width: `${q3Position - q1Position}%`,
          }}
        />
        <i
          className="distribution-median"
          style={{ left: `${position(distribution.median)}%` }}
        />
      </div>
      <strong>
        {formatNumber(distribution.median, 2)} {unit}
      </strong>
      <small>
        min {formatNumber(distribution.minimum, 2)} · IQR{' '}
        {formatNumber(distribution.interquartileRange, 2)} · max{' '}
        {formatNumber(distribution.maximum, 2)}
      </small>
    </div>
  );
}

function Total({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Summary({
  label,
  value,
  alert = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly alert?: boolean;
}) {
  return (
    <div className={alert && value > 0 ? 'metric alert' : 'metric'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
