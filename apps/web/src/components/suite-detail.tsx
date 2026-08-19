import type { Run, Suite } from '@messaging-lab/shared';

import { BROKER_LABELS, SCENARIO_LABELS, formatDate } from '../format.js';
import { StatusBadge } from './status-badge.js';

interface SuiteDetailProps {
  readonly suite: Suite;
  readonly disconnected: boolean;
  readonly onCancel: () => Promise<void>;
  readonly onSelectRun: (run: Run) => void;
}

export function SuiteDetail({
  suite,
  disconnected,
  onCancel,
  onSelectRun,
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
