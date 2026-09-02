import type { Run, RunEvent } from '@messaging-lab/shared';

import {
  BROKER_LABELS,
  COMPARISON_TRACK_LABELS,
  SCENARIO_LABELS,
  formatDate,
  formatNumber,
} from '../format.js';
import { StatusBadge } from './status-badge.js';

interface RunDetailProps {
  readonly run: Run | null;
  readonly progress: Extract<RunEvent, { type: 'progress' }> | null;
  readonly disconnected: boolean;
  readonly onCancel: () => Promise<void>;
  readonly onDelete: () => Promise<void>;
}

export function RunDetail({
  run,
  progress,
  disconnected,
  onCancel,
  onDelete,
}: RunDetailProps) {
  if (!run) {
    return (
      <section className="detail-panel empty-state" aria-label="Run details">
        <span className="empty-icon" aria-hidden="true">
          ↗
        </span>
        <h2>No experiment selected</h2>
        <p>Start a run or choose one from history to inspect its results.</p>
      </section>
    );
  }

  const active = run.status === 'pending' || run.status === 'running';
  const progressPercent = progress
    ? Math.min(
        100,
        Math.round((progress.completedUnits / progress.totalUnits) * 100),
      )
    : 0;

  return (
    <section className="detail-panel" aria-labelledby="run-detail-heading">
      <div className="run-detail-header">
        <div>
          <p className="eyebrow">Run {run.id.slice(0, 8)}</p>
          <h2 id="run-detail-heading">
            {run.name ??
              `${BROKER_LABELS[run.configuration.broker]} · ${SCENARIO_LABELS[run.configuration.scenario]}`}
          </h2>
          {run.name ? (
            <p className="muted">
              {BROKER_LABELS[run.configuration.broker]} ·{' '}
              {SCENARIO_LABELS[run.configuration.scenario]}
            </p>
          ) : null}
          <p className="muted">Started {formatDate(run.createdAt)}</p>
          <p className="muted">
            {COMPARISON_TRACK_LABELS[run.comparisonTrack]}
          </p>
          {run.description ? <p>{run.description}</p> : null}
        </div>
        <StatusBadge status={run.status} />
      </div>

      {disconnected && active ? (
        <div className="state-notice warning" role="alert">
          <strong>Live connection lost</strong>
          <span>
            Reconnecting automatically. Reload if live updates do not resume.
          </span>
        </div>
      ) : null}

      {active ? (
        <div className="live-progress" aria-live="polite">
          <div className="progress-label">
            <span>
              {progress ? phaseLabel(progress.phase) : 'Preparing run'}
            </span>
            <strong>{progressPercent}%</strong>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Run progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
            aria-valuetext={`${progressPercent}% complete`}
          >
            <span style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="progress-counts">
            <span>
              {formatNumber(progress?.publishedMessages ?? 0, 0)} published
            </span>
            <span>
              {formatNumber(progress?.receivedMessages ?? 0, 0)} received
            </span>
          </div>
          <button
            className="danger-button"
            type="button"
            onClick={() => void onCancel()}
          >
            Cancel run
          </button>
        </div>
      ) : null}
      {!active ? (
        <button
          className="danger-button history-delete"
          type="button"
          onClick={() => void onDelete()}
        >
          Delete run
        </button>
      ) : null}

      {run.metrics ? (
        <>
          <div className="metric-grid">
            <Metric
              label="Throughput"
              value={`${formatNumber(run.metrics.throughputMessagesPerSecond)} msg/s`}
            />
            <Metric
              label="Elapsed"
              value={`${formatNumber(run.metrics.elapsedMs)} ms`}
            />
            <Metric
              label="p50 latency"
              value={`${formatNumber(run.metrics.latency.p50Ms, 2)} ms`}
            />
            <Metric
              label="p95 latency"
              value={`${formatNumber(run.metrics.latency.p95Ms, 2)} ms`}
            />
            <Metric
              label="p99 latency"
              value={`${formatNumber(run.metrics.latency.p99Ms, 2)} ms`}
            />
            <Metric
              label="Delivered"
              value={`${formatNumber(run.metrics.receivedMessages, 0)} / ${formatNumber(run.metrics.publishedMessages, 0)}`}
            />
            <Metric
              label="Lost"
              value={formatNumber(run.metrics.lostMessages, 0)}
              alert={run.metrics.lostMessages > 0}
            />
            <Metric
              label="Duplicates"
              value={formatNumber(run.metrics.duplicateMessages, 0)}
              alert={run.metrics.duplicateMessages > 0}
            />
            <Metric
              label="Global order violations"
              value={formatNumber(run.metrics.ordering.globalViolations, 0)}
              alert={run.metrics.ordering.globalViolations > 0}
            />
            <Metric
              label="Native-scope order violations"
              value={formatNumber(
                run.metrics.ordering.nativeScopeViolations,
                0,
              )}
              alert={run.metrics.ordering.nativeScopeViolations > 0}
            />
            <Metric
              label="Maximum observed backlog"
              value={formatNumber(
                run.metrics.backlog.maximumObservedMessages,
                0,
              )}
            />
            <Metric
              label="Final observed backlog"
              value={formatNumber(run.metrics.backlog.finalObservedMessages, 0)}
              alert={run.metrics.backlog.finalObservedMessages > 0}
            />
          </div>
          <p className="muted aggregate-intro">
            Global order is observed at the application path. Native-scope order
            follows the adapter's partition, queue, or stream boundary. Observed
            backlog is not a combined broker lag metric.
          </p>
        </>
      ) : !active ? (
        <TerminalMessage status={run.status} />
      ) : null}

      {run.notes.length > 0 ? (
        <div className="notes-block">
          <h3>Semantic notes</h3>
          <ul>
            {run.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {run.errors.length > 0 ? (
        <div className="errors-block" role="alert">
          <h3>Run errors</h3>
          <ul>
            {run.errors.map((error) => (
              <li key={`${error.code}-${error.occurredAt}`}>
                <strong>{error.code}</strong> {error.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Metric({
  label,
  value,
  alert = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly alert?: boolean;
}) {
  return (
    <div className={alert ? 'metric alert' : 'metric'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TerminalMessage({ status }: { readonly status: Run['status'] }) {
  const messages = {
    failed: 'The experiment failed before aggregate metrics were available.',
    'timed-out': 'The experiment exceeded its configured timeout.',
    cancelled:
      'The experiment was cancelled and its broker resources were cleaned up.',
    completed: 'The experiment completed without aggregate metrics.',
    pending: '',
    running: '',
  } as const;
  return (
    <div className={`state-notice ${status}`}>
      <strong>{messages[status]}</strong>
    </div>
  );
}

function phaseLabel(phase: string): string {
  return phase
    .replaceAll('-', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}
