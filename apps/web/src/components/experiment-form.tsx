import { useMemo, useState, type FormEvent } from 'react';

import {
  BENCHMARK_DEFAULTS,
  BENCHMARK_LIMITS,
  EXPERIMENT_DESCRIPTION_MAX_LENGTH,
  BROKER_CAPABILITIES,
  BROKER_IDS,
  SCENARIO_IDS,
  SUITE_DEFAULTS,
  SUITE_LIMITS,
  createSuiteRequestSchema,
  comparisonTrackFor,
  startRunRequestSchema,
  workloadConfigurationSchema,
  type BrokerId,
  type CreateSuiteRequest,
  type ScenarioId,
  type StartRunRequest,
  type SuiteCombination,
  type SuiteOrderStrategy,
  type SweepParameter,
  type WorkloadConfiguration,
} from '@messaging-lab/shared';

import {
  BROKER_LABELS,
  COMPARISON_TRACK_LABELS,
  SCENARIO_LABELS,
} from '../format.js';

interface ExperimentFormProps {
  readonly disabled: boolean;
  readonly onStart: (request: StartRunRequest) => Promise<void>;
  readonly onStartSuite: (request: CreateSuiteRequest) => Promise<void>;
}

const ALL_COMBINATIONS: SuiteCombination[] = BROKER_IDS.flatMap((broker) =>
  SCENARIO_IDS.map((scenario) => ({ broker, scenario })),
);
const PRESET_STORAGE_KEY = 'messaging-lab.workload-presets.v1';
const SWEEP_LABELS: Record<SweepParameter, string> = {
  consumerCount: 'Consumers',
  producerConcurrency: 'Producers',
  payloadSizeBytes: 'Payload size (bytes)',
  messageCount: 'Message count',
  consumerDelayMs: 'Consumer delay (ms)',
};
interface WorkloadPreset {
  readonly name: string;
  readonly workload: WorkloadConfiguration;
}

export function ExperimentForm({
  disabled,
  onStart,
  onStartSuite,
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
  const [consumerDelayMs, setConsumerDelayMs] = useState<number>(
    BENCHMARK_DEFAULTS.consumerDelayMs,
  );
  const [timeoutMs, setTimeoutMs] = useState<number>(
    BENCHMARK_DEFAULTS.timeoutMs,
  );
  const [suiteName, setSuiteName] = useState('Benchmark suite');
  const [suiteDescription, setSuiteDescription] = useState('');
  const [runName, setRunName] = useState('');
  const [runDescription, setRunDescription] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presets, setPresets] = useState<WorkloadPreset[]>(loadPresets);
  const [repetitions, setRepetitions] = useState<number>(
    SUITE_DEFAULTS.repetitions,
  );
  const [orderStrategy, setOrderStrategy] = useState<SuiteOrderStrategy>(
    SUITE_DEFAULTS.orderStrategy,
  );
  const [cooldownMs, setCooldownMs] = useState<number>(
    SUITE_DEFAULTS.cooldownMs,
  );
  const [sweepParameter, setSweepParameter] = useState<SweepParameter | 'none'>(
    'none',
  );
  const [sweepValues, setSweepValues] = useState('1, 2, 4');
  const [selectedCombinations, setSelectedCombinations] = useState(
    () => new Set(ALL_COMBINATIONS.map(combinationKey)),
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const capability = useMemo(
    () => BROKER_CAPABILITIES[broker][scenario],
    [broker, scenario],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = validatedRunRequest();
    if (request) await onStart(request);
  }

  async function startSuite(): Promise<void> {
    const combinations = ALL_COMBINATIONS.filter((combination) =>
      selectedCombinations.has(combinationKey(combination)),
    );
    const request: CreateSuiteRequest = {
      name: suiteName,
      description: suiteDescription,
      workload: workload(),
      combinations,
      repetitions,
      orderStrategy,
      cooldownMs,
      ...(sweepParameter === 'none'
        ? {}
        : {
            sweep: {
              parameter: sweepParameter,
              values: parseSweepValues(sweepValues),
            },
          }),
    };
    const parsed = createSuiteRequestSchema.safeParse(request);
    if (!parsed.success) {
      setValidationError(
        parsed.error.issues[0]?.message ?? 'Check the suite values.',
      );
      return;
    }
    setValidationError(null);
    await onStartSuite(request);
  }

  function validatedRunRequest(): StartRunRequest | null {
    const parsed = startRunRequestSchema.safeParse({
      broker,
      scenario,
      name: runName.trim() || null,
      description: runDescription,
      ...workload(),
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

  function workload() {
    return {
      messageCount,
      payloadSizeBytes,
      producerConcurrency,
      consumerCount,
      consumerDelayMs,
      timeoutMs,
    };
  }

  function toggleCombination(combination: SuiteCombination): void {
    const key = combinationKey(combination);
    setSelectedCombinations((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function savePreset(): void {
    const name = presetName.trim();
    if (!name) {
      setValidationError('Enter a preset name.');
      return;
    }
    const next = [
      ...presets.filter((preset) => preset.name !== name),
      { name, workload: workload() },
    ];
    try {
      window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next));
    } catch {
      setValidationError('This browser could not save the workload preset.');
      return;
    }
    setPresets(next);
    setPresetName('');
    setValidationError(null);
  }

  function applyPreset(name: string): void {
    const preset = presets.find((item) => item.name === name);
    if (!preset) return;
    setMessageCount(preset.workload.messageCount);
    setPayloadSizeBytes(preset.workload.payloadSizeBytes);
    setProducerConcurrency(preset.workload.producerConcurrency);
    setConsumerCount(preset.workload.consumerCount);
    setConsumerDelayMs(preset.workload.consumerDelayMs);
    setTimeoutMs(preset.workload.timeoutMs);
  }

  return (
    <section className="experiment-panel" aria-labelledby="experiment-heading">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">New experiment</p>
          <h2 id="experiment-heading">Configure workloads</h2>
        </div>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={disabled}>
          <div className="form-grid two-columns">
            <label>
              Standalone broker
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
              Standalone scenario
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

          <div className="form-grid two-columns experiment-metadata">
            <label>
              Standalone name (optional)
              <input
                value={runName}
                maxLength={SUITE_LIMITS.nameLength.max}
                onChange={(event) => setRunName(event.target.value)}
              />
            </label>
            <label>
              Standalone description (optional)
              <input
                value={runDescription}
                maxLength={EXPERIMENT_DESCRIPTION_MAX_LENGTH}
                onChange={(event) => setRunDescription(event.target.value)}
              />
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
              label="Consumer delay (ms)"
              value={consumerDelayMs}
              limits={BENCHMARK_LIMITS.consumerDelayMs}
              onChange={setConsumerDelayMs}
            />
            <NumberField
              label="Timeout (ms)"
              value={timeoutMs}
              limits={BENCHMARK_LIMITS.timeoutMs}
              onChange={setTimeoutMs}
            />
          </div>

          <div className="preset-controls" aria-label="Saved workload presets">
            <label>
              Load preset
              <select
                defaultValue=""
                onChange={(event) => applyPreset(event.target.value)}
              >
                <option value="">Choose a preset</option>
                {presets.map((preset) => (
                  <option key={preset.name} value={preset.name}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Preset name
              <input
                value={presetName}
                maxLength={120}
                onChange={(event) => setPresetName(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={savePreset}
            >
              Save workload preset
            </button>
          </div>

          <div
            className="suite-builder"
            aria-labelledby="suite-builder-heading"
          >
            <div>
              <h3 id="suite-builder-heading">Persistent suite</h3>
              <p>
                Choose trials from any track. Scheduling may be mixed; results
                and conclusions remain separated by track.
              </p>
            </div>
            <label>
              Suite name
              <input
                value={suiteName}
                maxLength={SUITE_LIMITS.nameLength.max}
                onChange={(event) => setSuiteName(event.target.value)}
              />
            </label>
            <label>
              Suite description (optional)
              <input
                value={suiteDescription}
                maxLength={EXPERIMENT_DESCRIPTION_MAX_LENGTH}
                onChange={(event) => setSuiteDescription(event.target.value)}
              />
            </label>
            <fieldset className="combination-picker">
              <legend>Broker and scenario combinations</legend>
              {ALL_COMBINATIONS.map((combination) => {
                const key = combinationKey(combination);
                return (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={selectedCombinations.has(key)}
                      onChange={() => toggleCombination(combination)}
                    />
                    <span>
                      {BROKER_LABELS[combination.broker]} ·{' '}
                      {SCENARIO_LABELS[combination.scenario]}
                      <small aria-hidden="true">
                        {
                          COMPARISON_TRACK_LABELS[
                            comparisonTrackFor(
                              combination.broker,
                              combination.scenario,
                            )
                          ]
                        }
                      </small>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <div className="form-grid suite-options">
              <NumberField
                label="Repetitions"
                value={repetitions}
                limits={SUITE_LIMITS.repetitions}
                onChange={setRepetitions}
              />
              <label>
                Order
                <select
                  value={orderStrategy}
                  onChange={(event) =>
                    setOrderStrategy(event.target.value as SuiteOrderStrategy)
                  }
                >
                  <option value="fixed">Fixed</option>
                  <option value="rotating">Rotating</option>
                  <option value="randomized">Randomized</option>
                </select>
              </label>
              <NumberField
                label="Cooldown (ms)"
                value={cooldownMs}
                limits={SUITE_LIMITS.cooldownMs}
                onChange={setCooldownMs}
              />
            </div>
            <div className="form-grid two-columns sweep-options">
              <label>
                Parameter sweep
                <select
                  value={sweepParameter}
                  onChange={(event) =>
                    setSweepParameter(
                      event.target.value as SweepParameter | 'none',
                    )
                  }
                >
                  <option value="none">No sweep</option>
                  {Object.entries(SWEEP_LABELS).map(([parameter, label]) => (
                    <option key={parameter} value={parameter}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sweep values
                <input
                  value={sweepValues}
                  disabled={sweepParameter === 'none'}
                  aria-describedby="sweep-values-help"
                  onChange={(event) => setSweepValues(event.target.value)}
                />
                <small id="sweep-values-help">
                  Comma-separated, unique, increasing integers
                </small>
              </label>
            </div>
            <p className="suite-size" aria-live="polite">
              {selectedCombinations.size *
                repetitions *
                (sweepParameter === 'none'
                  ? 1
                  : Math.max(parseSweepValues(sweepValues).length, 1))}{' '}
              generated runs (maximum {SUITE_LIMITS.totalRuns.max})
            </p>
          </div>
        </fieldset>

        {validationError ? (
          <p className="form-error" role="alert">
            {validationError}
          </p>
        ) : null}
        <div className="experiment-actions">
          <button className="primary-button" type="submit" disabled={disabled}>
            <span aria-hidden="true">▶</span>
            {disabled ? 'Experiment running' : 'Start standalone run'}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={disabled}
            onClick={() => void startSuite()}
          >
            <span aria-hidden="true">↻</span>
            Start benchmark suite
          </button>
        </div>
        <p className="suite-hint">
          Suites continue on the server if this page closes or reloads.
        </p>
      </form>
    </section>
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

function parseSweepValues(value: string): number[] {
  return value.split(',').map((part) => Number(part.trim()));
}

function combinationKey({ broker, scenario }: SuiteCombination): string {
  return `${broker}:${scenario}`;
}

function humanize(value: string): string {
  return value
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function loadPresets(): WorkloadPreset[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(PRESET_STORAGE_KEY) ?? '[]',
    );
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        !('name' in value) ||
        !('workload' in value)
      )
        return [];
      const workload = workloadConfigurationSchema.safeParse(value.workload);
      return typeof value.name === 'string' && workload.success
        ? [{ name: value.name, workload: workload.data }]
        : [];
    });
  } catch {
    return [];
  }
}
