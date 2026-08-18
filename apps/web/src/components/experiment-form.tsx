import { useMemo, useState, type FormEvent } from 'react';

import {
  BENCHMARK_DEFAULTS,
  BENCHMARK_LIMITS,
  BROKER_CAPABILITIES,
  BROKER_IDS,
  SCENARIO_IDS,
  startRunRequestSchema,
  type BrokerId,
  type ScenarioId,
  type StartRunRequest,
} from '@messaging-lab/shared';

import { BROKER_LABELS, SCENARIO_LABELS } from '../format.js';

export interface BatchProgress {
  readonly completed: number;
  readonly current: number;
  readonly total: number;
  readonly status: 'running' | 'completed' | 'stopped';
}

interface ExperimentFormProps {
  readonly disabled: boolean;
  readonly batchProgress: BatchProgress | null;
  readonly onStart: (request: StartRunRequest) => Promise<void>;
  readonly onRunAll: (request: StartRunRequest) => Promise<void>;
}

export function ExperimentForm({
  disabled,
  batchProgress,
  onStart,
  onRunAll,
}: ExperimentFormProps) {
  const [broker, setBroker] = useState<BrokerId>('redis');
  const [scenario, setScenario] = useState<ScenarioId>('fan-out');
  const [messageCount, setMessageCount] = useState<number>(
    BENCHMARK_DEFAULTS.messageCount,
  );
  const [payloadSizeBytes, setPayloadSizeBytes] = useState<number>(
    BENCHMARK_DEFAULTS.payloadSizeBytes,
  );
  const [producerConcurrency, setProducerConcurrency] = useState<number>(
    BENCHMARK_DEFAULTS.producerConcurrency,
  );
  const [consumerCount, setConsumerCount] = useState<number>(
    BENCHMARK_DEFAULTS.consumerCount,
  );
  const [timeoutMs, setTimeoutMs] = useState<number>(
    BENCHMARK_DEFAULTS.timeoutMs,
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const capability = useMemo(
    () => BROKER_CAPABILITIES[broker][scenario],
    [broker, scenario],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = validatedRequest();
    if (request) await onStart(request);
  }

  async function runAll(): Promise<void> {
    const request = validatedRequest();
    if (request) await onRunAll(request);
  }

  function validatedRequest(): StartRunRequest | null {
    const parsed = startRunRequestSchema.safeParse({
      broker,
      scenario,
      messageCount,
      payloadSizeBytes,
      producerConcurrency,
      consumerCount,
      timeoutMs,
    });
    if (!parsed.success) {
      setValidationError(
        parsed.error.issues[0]?.message ?? 'Check the experiment values.',
      );
      return null;
    }
    setValidationError(null);
    return parsed.data;
  }

  return (
    <section className="experiment-panel" aria-labelledby="experiment-heading">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">New experiment</p>
          <h2 id="experiment-heading">Configure a run</h2>
        </div>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={disabled}>
          <div className="form-grid two-columns">
            <label>
              Broker
              <select
                value={broker}
                onChange={(event) => setBroker(event.target.value as BrokerId)}
              >
                {BROKER_IDS.map((id) => (
                  <option key={id} value={id}>
                    {BROKER_LABELS[id]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Scenario
              <select
                value={scenario}
                onChange={(event) =>
                  setScenario(event.target.value as ScenarioId)
                }
              >
                {SCENARIO_IDS.map((id) => (
                  <option key={id} value={id}>
                    {SCENARIO_LABELS[id]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="capability-callout">
            <strong>
              {SCENARIO_LABELS[scenario]} on {BROKER_LABELS[broker]}
            </strong>
            <p>{capability.notes.join(' ')}</p>
            <div
              className="capability-pills"
              aria-label="Scenario capabilities"
            >
              {(
                [
                  'persistence',
                  'acknowledgements',
                  'consumerRecovery',
                  'replay',
                ] as const
              ).map((flag) => (
                <span
                  className={capability[flag] ? 'supported' : 'unsupported'}
                  key={flag}
                >
                  {humanize(flag)} · {capability[flag] ? 'yes' : 'no'}
                </span>
              ))}
            </div>
          </div>

          <div className="form-grid">
            <NumberField
              label="Messages"
              value={messageCount}
              limits={BENCHMARK_LIMITS.messageCount}
              onChange={setMessageCount}
            />
            <NumberField
              label="Payload (bytes)"
              value={payloadSizeBytes}
              limits={BENCHMARK_LIMITS.payloadSizeBytes}
              onChange={setPayloadSizeBytes}
            />
            <NumberField
              label="Producers"
              value={producerConcurrency}
              limits={BENCHMARK_LIMITS.producerConcurrency}
              onChange={setProducerConcurrency}
            />
            <NumberField
              label="Consumers"
              value={consumerCount}
              limits={BENCHMARK_LIMITS.consumerCount}
              onChange={setConsumerCount}
            />
            <NumberField
              label="Timeout (ms)"
              value={timeoutMs}
              limits={BENCHMARK_LIMITS.timeoutMs}
              onChange={setTimeoutMs}
            />
          </div>
        </fieldset>
        {validationError ? (
          <p className="form-error" role="alert">
            {validationError}
          </p>
        ) : null}
        {batchProgress ? <BatchStatus progress={batchProgress} /> : null}
        <div className="experiment-actions">
          <button className="primary-button" type="submit" disabled={disabled}>
            <span aria-hidden="true">▶</span>
            {disabled ? 'Experiment running' : 'Start experiment'}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={disabled}
            onClick={() => void runAll()}
          >
            <span aria-hidden="true">↻</span>
            {batchProgress?.status === 'running'
              ? `Running ${batchProgress.current} of ${batchProgress.total}`
              : 'Run all 6 sequentially'}
          </button>
        </div>
        <p className="suite-hint">
          Uses these workload values for every broker and pattern. Runs are
          sequential so results do not compete for local resources.
        </p>
      </form>
    </section>
  );
}

function BatchStatus({ progress }: { readonly progress: BatchProgress }) {
  const message =
    progress.status === 'completed'
      ? 'Suite complete'
      : progress.status === 'stopped'
        ? 'Suite stopped'
        : `Running experiment ${progress.current} of ${progress.total}`;

  return (
    <div className={`batch-status batch-${progress.status}`} aria-live="polite">
      <div>
        <strong>{message}</strong>
        <span>
          {progress.completed}/{progress.total} finished
        </span>
      </div>
      <div className="batch-track" aria-hidden="true">
        <span
          style={{ width: `${(progress.completed / progress.total) * 100}%` }}
        />
      </div>
    </div>
  );
}

interface NumberFieldProps {
  readonly label: string;
  readonly value: number;
  readonly limits: { readonly min: number; readonly max: number };
  readonly onChange: (value: number) => void;
}

function NumberField({ label, value, limits, onChange }: NumberFieldProps) {
  return (
    <label>
      {label}
      <input
        type="number"
        value={value}
        min={limits.min}
        max={limits.max}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <small>
        {limits.min.toLocaleString()}–{limits.max.toLocaleString()}
      </small>
    </label>
  );
}

function humanize(value: string): string {
  return value
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (letter) => letter.toUpperCase());
}
