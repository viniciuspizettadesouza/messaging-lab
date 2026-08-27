import type { KeyboardEvent } from 'react';

import {
  BROKER_IDS,
  SCENARIO_IDS,
  type Run,
  type Suite,
  type ComparisonSelection,
} from '@messaging-lab/shared';

import {
  BROKER_LABELS,
  COMPARISON_TRACK_LABELS,
  SCENARIO_LABELS,
  formatDate,
  formatNumber,
} from '../format.js';
import { StatusBadge } from './status-badge.js';

interface RunHistoryProps {
  readonly runs: Run[];
  readonly suites: Suite[];
  readonly selectedRunId: string | null;
  readonly selectedSuiteId: string | null;
  readonly onSelectRun: (run: Run) => void;
  readonly onSelectSuite: (suite: Suite) => void;
  readonly filters: HistoryFilters;
  readonly onFiltersChange: (filters: HistoryFilters) => void;
  readonly page: number;
  readonly totalPages: number;
  readonly runTotal: number;
  readonly suiteTotal: number;
  readonly onPageChange: (page: number) => void;
  readonly comparisonIds: ReadonlySet<string>;
  readonly onToggleComparison: (kind: 'run' | 'suite', id: string) => void;
}

export interface HistoryFilters {
  readonly broker: string;
  readonly scenario: string;
  readonly status: string;
  readonly suite: string;
  readonly dateFrom: string;
  readonly dateTo: string;
}

export function RunHistory({
  runs,
  suites,
  selectedRunId,
  selectedSuiteId,
  onSelectRun,
  onSelectSuite,
  filters,
  onFiltersChange,
  page,
  totalPages,
  runTotal,
  suiteTotal,
  onPageChange,
  comparisonIds,
  onToggleComparison,
}: RunHistoryProps) {
  const suiteRunIds = new Set(
    suites.flatMap((suite) =>
      suite.runs.flatMap((item) => (item.run ? [item.run.id] : [])),
    ),
  );
  const standaloneRuns = runs.filter((run) => !suiteRunIds.has(run.id));
  const totalExperiments = suites.length + standaloneRuns.length;

  return (
    <section className="section-block" aria-labelledby="history-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">SQLite history</p>
          <h2 id="history-heading">Suites and standalone runs</h2>
        </div>
        <p>
          {suites.length} {suites.length === 1 ? 'suite' : 'suites'} ·{' '}
          {standaloneRuns.length} standalone{' '}
          {standaloneRuns.length === 1 ? 'run' : 'runs'}
        </p>
      </div>
      <div className="history-filters" aria-label="History filters">
        <FilterSelect
          label="Broker"
          value={filters.broker}
          values={BROKER_IDS}
          labels={BROKER_LABELS}
          onChange={(broker) => onFiltersChange({ ...filters, broker })}
        />
        <FilterSelect
          label="Scenario"
          value={filters.scenario}
          values={SCENARIO_IDS}
          labels={SCENARIO_LABELS}
          onChange={(scenario) => onFiltersChange({ ...filters, scenario })}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          values={['pending', 'running', 'completed', 'failed', 'cancelled']}
          onChange={(status) => onFiltersChange({ ...filters, status })}
        />
        <label>
          Suite ID
          <input
            value={filters.suite}
            placeholder="UUID"
            onChange={(event) =>
              onFiltersChange({ ...filters, suite: event.target.value })
            }
          />
        </label>
        <label>
          From
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(event) =>
              onFiltersChange({ ...filters, dateFrom: event.target.value })
            }
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={filters.dateTo}
            onChange={(event) =>
              onFiltersChange({ ...filters, dateTo: event.target.value })
            }
          />
        </label>
      </div>
      {totalExperiments === 0 ? (
        <div className="empty-row">
          <strong>No experiments yet.</strong>
          <span>Your first run or suite will appear here.</span>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Experiment</th>
                <th>Pattern</th>
                <th>Status</th>
                <th>Created</th>
                <th>Throughput</th>
                <th>Compare</th>
              </tr>
            </thead>
            <tbody>
              {suites.map((suite) => (
                <SuiteRows
                  key={suite.id}
                  suite={suite}
                  selectedSuiteId={selectedSuiteId}
                  selectedRunId={selectedRunId}
                  onSelectSuite={onSelectSuite}
                  onSelectRun={onSelectRun}
                  comparisonIds={comparisonIds}
                  onToggleComparison={onToggleComparison}
                />
              ))}
              {standaloneRuns.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  selected={selectedRunId === run.id}
                  onSelect={onSelectRun}
                  standalone
                  comparisonIds={comparisonIds}
                  onToggleComparison={onToggleComparison}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {totalExperiments > 0 ? (
        <p className="keyboard-hint">
          Use Tab to enter history and the up/down arrow keys to move between
          experiments.
        </p>
      ) : null}
      <div className="history-pagination" aria-label="History pagination">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <span>
          Page {page} of {totalPages} · {suiteTotal} suites · {runTotal} runs
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
      <ManualComparison
        runs={runs}
        suites={suites}
        comparisonIds={comparisonIds}
      />
    </section>
  );
}

function SuiteRows({
  suite,
  selectedSuiteId,
  selectedRunId,
  onSelectSuite,
  onSelectRun,
  comparisonIds,
  onToggleComparison,
}: {
  readonly suite: Suite;
  readonly selectedSuiteId: string | null;
  readonly selectedRunId: string | null;
  readonly onSelectSuite: (suite: Suite) => void;
  readonly onSelectRun: (run: Run) => void;
  readonly comparisonIds: ReadonlySet<string>;
  readonly onToggleComparison: (kind: 'run' | 'suite', id: string) => void;
}) {
  return (
    <>
      <tr
        className={`suite-history-row ${selectedSuiteId === suite.id ? 'selected' : ''}`}
      >
        <td>
          <button
            className="table-link history-link"
            type="button"
            data-history-link
            aria-current={selectedSuiteId === suite.id ? 'true' : undefined}
            onKeyDown={navigateHistory}
            onClick={() => onSelectSuite(suite)}
          >
            {suite.name}
          </button>
          {suite.description ? (
            <small className="row-description">{suite.description}</small>
          ) : null}
          <span className="row-kind">
            Suite · {suite.progress.totalRuns} trials
          </span>
        </td>
        <td>{suite.configuration.orderStrategy}</td>
        <td>
          <StatusBadge status={suite.status} />
        </td>
        <td>{formatDate(suite.createdAt)}</td>
        <td>
          {suite.progress.completedRuns}/{suite.progress.totalRuns} finished
        </td>
        <td>
          <ComparisonCheckbox
            label={`Compare suite ${suite.name}`}
            checked={comparisonIds.has(`suite:${suite.id}`)}
            onChange={() => onToggleComparison('suite', suite.id)}
          />
        </td>
      </tr>
      {suite.runs.map((item) =>
        item.run ? (
          <RunRow
            key={item.run.id}
            run={item.run}
            selected={selectedRunId === item.run.id}
            onSelect={onSelectRun}
            suiteChild
            comparisonIds={comparisonIds}
            onToggleComparison={onToggleComparison}
          />
        ) : null,
      )}
    </>
  );
}

function RunRow({
  run,
  selected,
  onSelect,
  suiteChild = false,
  standalone = false,
  comparisonIds,
  onToggleComparison,
}: {
  readonly run: Run;
  readonly selected: boolean;
  readonly onSelect: (run: Run) => void;
  readonly suiteChild?: boolean;
  readonly standalone?: boolean;
  readonly comparisonIds: ReadonlySet<string>;
  readonly onToggleComparison: (kind: 'run' | 'suite', id: string) => void;
}) {
  return (
    <tr
      className={`${selected ? 'selected' : ''} ${suiteChild ? 'suite-child-row' : ''}`}
    >
      <td>
        <button
          className="table-link history-link"
          type="button"
          data-history-link
          aria-current={selected ? 'true' : undefined}
          onKeyDown={navigateHistory}
          onClick={() => onSelect(run)}
        >
          {suiteChild ? '↳ ' : ''}
          {run.name ?? BROKER_LABELS[run.configuration.broker]}
        </button>
        {run.description ? (
          <small className="row-description">{run.description}</small>
        ) : null}
        {standalone ? <span className="row-kind">Standalone run</span> : null}
      </td>
      <td>{SCENARIO_LABELS[run.configuration.scenario]}</td>
      <td>
        <StatusBadge status={run.status} />
      </td>
      <td>{formatDate(run.createdAt)}</td>
      <td>
        {run.metrics
          ? `${formatNumber(run.metrics.throughputMessagesPerSecond)} msg/s`
          : '—'}
      </td>
      <td>
        <ComparisonCheckbox
          label={`Compare run ${run.name ?? BROKER_LABELS[run.configuration.broker]}`}
          checked={comparisonIds.has(`run:${run.id}`)}
          onChange={() => onToggleComparison('run', run.id)}
        />
      </td>
    </tr>
  );
}

function FilterSelect({
  label,
  value,
  values,
  labels,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly values: readonly string[];
  readonly labels?: Record<string, string>;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {values.map((item) => (
          <option key={item} value={item}>
            {labels?.[item] ?? item}
          </option>
        ))}
      </select>
    </label>
  );
}

function ComparisonCheckbox({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: () => void;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={onChange}
    />
  );
}

function ManualComparison({
  runs,
  suites,
  comparisonIds,
}: {
  readonly runs: Run[];
  readonly suites: Suite[];
  readonly comparisonIds: ReadonlySet<string>;
}) {
  const entries: ComparisonSelection[] = [
    ...runs
      .filter(({ id }) => comparisonIds.has(`run:${id}`))
      .flatMap((run) =>
        run.metrics
          ? [
              {
                id: `run:${run.id}`,
                label: run.name ?? `Run ${run.id.slice(0, 8)}`,
                broker: run.configuration.broker,
                scenario: run.configuration.scenario,
                comparisonTrack: run.comparisonTrack,
                throughputMessagesPerSecond:
                  run.metrics.throughputMessagesPerSecond,
                p95LatencyMs: run.metrics.latency.p95Ms,
              },
            ]
          : [],
      ),
    ...suites
      .filter(({ id }) => comparisonIds.has(`suite:${id}`))
      .flatMap((suite) =>
        suite.combinationSummaries.flatMap((summary) =>
          summary.throughput
            ? [
                {
                  id: `suite:${suite.id}:${summary.combinationIndex}`,
                  label: suite.name,
                  broker: summary.combination.broker,
                  scenario: summary.combination.scenario,
                  comparisonTrack: summary.comparisonTrack,
                  throughputMessagesPerSecond: summary.throughput.median,
                  p95LatencyMs: summary.latency.p95Ms?.median ?? null,
                },
              ]
            : [],
        ),
      ),
  ];
  if (comparisonIds.size === 0) return null;
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const group = `${entry.comparisonTrack}:${entry.scenario}`;
    groups.set(group, [...(groups.get(group) ?? []), entry]);
  }
  const selectedTracks = new Set(entries.map((entry) => entry.comparisonTrack));
  const isSemanticContrast = selectedTracks.size > 1;
  return (
    <section
      className="manual-comparison"
      aria-labelledby="manual-comparison-heading"
    >
      <h3 id="manual-comparison-heading">
        {isSemanticContrast ? 'Semantic contrasts' : 'Manual comparison'}
      </h3>
      <p>
        {isSemanticContrast
          ? 'Cross-track values are context-only contrasts. No shared winner, ranking, or combined aggregate is produced.'
          : 'Results remain separated by workload pattern within their comparison track.'}
      </p>
      {entries.length === 0 ? (
        <p>No selected experiment has completed metrics.</p>
      ) : null}
      {[...groups].map(([group, groupEntries]) => (
        <article key={group}>
          <h4>
            {COMPARISON_TRACK_LABELS[groupEntries[0]!.comparisonTrack]} ·{' '}
            {SCENARIO_LABELS[groupEntries[0]!.scenario]}
          </h4>
          <ul>
            {groupEntries.map((entry) => (
              <li key={entry.id}>
                <span>
                  {entry.label} · {BROKER_LABELS[entry.broker]}
                </span>
                <strong>
                  {formatNumber(entry.throughputMessagesPerSecond, 2)} msg/s
                  {entry.p95LatencyMs === null
                    ? ''
                    : ` · p95 ${formatNumber(entry.p95LatencyMs, 2)} ms`}
                </strong>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

function navigateHistory(event: KeyboardEvent<HTMLButtonElement>): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const section = event.currentTarget.closest('section');
  const links = Array.from(
    section?.querySelectorAll<HTMLButtonElement>('[data-history-link]') ?? [],
  );
  const index = links.indexOf(event.currentTarget);
  const direction = event.key === 'ArrowDown' ? 1 : -1;
  const target = links[(index + direction + links.length) % links.length];
  if (!target) return;
  event.preventDefault();
  target.focus();
}
