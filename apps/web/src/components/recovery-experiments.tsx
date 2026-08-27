import { useMemo, useState } from 'react';

import {
  RECOVERY_EXPERIMENT_TYPES,
  recoveryExperimentDefinitions,
  type RecoveryExperimentResult,
  type RecoveryExperimentType,
} from '@messaging-lab/shared';

interface RecoveryExperimentsProps {
  readonly disabled: boolean;
  readonly onRun: (
    type: RecoveryExperimentType,
  ) => Promise<RecoveryExperimentResult>;
}

export function RecoveryExperiments({
  disabled,
  onRun,
}: RecoveryExperimentsProps) {
  const [type, setType] = useState<RecoveryExperimentType>(
    'redis-streams-pending-recovery',
  );
  const [result, setResult] = useState<RecoveryExperimentResult | null>(null);
  const [running, setRunning] = useState(false);
  const definition = useMemo(() => recoveryExperimentDefinitions[type], [type]);

  async function run(): Promise<void> {
    setRunning(true);
    try {
      setResult(await onRun(type));
    } catch {
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="recovery-panel" aria-labelledby="recovery-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Broker-native behavior</p>
          <h2 id="recovery-heading">Recovery and replay lab</h2>
        </div>
        <p>
          Interrupt consumers at message 2 of 5 and observe each broker's own
          durability model. These are behavioral demonstrations, not performance
          comparisons.
        </p>
      </div>

      <div className="recovery-layout">
        <div>
          <label>
            Experiment
            <select
              value={type}
              disabled={disabled || running}
              onChange={(event) => {
                setType(event.target.value as RecoveryExperimentType);
                setResult(null);
              }}
            >
              {RECOVERY_EXPERIMENT_TYPES.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {recoveryExperimentDefinitions[candidate].label}
                </option>
              ))}
            </select>
          </label>
          <div className="capability-callout">
            <strong>Expected behavior</strong>
            <p>{definition.expectedBehavior}</p>
            <p>
              Replay:{' '}
              {definition.replaySupported
                ? 'supported through retained broker state'
                : 'unsupported; the result explains why'}
              .
            </p>
          </div>
          <button
            className="primary-button"
            type="button"
            disabled={disabled || running}
            onClick={() => void run()}
          >
            {running
              ? 'Running recovery experiment…'
              : 'Run recovery experiment'}
          </button>
        </div>

        <div className="recovery-result" aria-live="polite">
          {result ? (
            <>
              <div className="run-detail-header">
                <div>
                  <p className="eyebrow">Observed behavior</p>
                  <h3>{recoveryExperimentDefinitions[result.type].label}</h3>
                </div>
                <span className={`status-badge ${result.status}`}>
                  {result.status}
                </span>
              </div>
              <p>{result.observedBehavior}</p>
              <p>{result.replay.explanation}</p>
              <div className="metric-grid">
                <RecoveryMetric
                  label="Recovery time"
                  value={
                    result.observations.recoveryTimeMs === null
                      ? '—'
                      : `${result.observations.recoveryTimeMs.toFixed(1)} ms`
                  }
                />
                <RecoveryMetric
                  label="Redelivered"
                  value={result.observations.redeliveredMessages}
                />
                <RecoveryMetric
                  label="Duplicates"
                  value={result.observations.duplicateMessages}
                />
                <RecoveryMetric
                  label="Lost"
                  value={result.observations.lostMessages}
                />
                <RecoveryMetric
                  label="Errors"
                  value={result.observations.errorCount}
                />
              </div>
              <p className="cleanup-note">
                Cleanup removed {result.resourceCleanup.removedResources} of{' '}
                {result.resourceCleanup.attemptedResources} attempted resources
                with {result.resourceCleanup.failures.length} failures.
              </p>
            </>
          ) : (
            <div className="empty-state">
              <strong>No recovery observation yet</strong>
              <p>
                Select a native experiment to compare expectation with evidence.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function RecoveryMetric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | number;
}) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
