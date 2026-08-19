import type { KeyboardEvent } from 'react';

import type { Run, Suite } from '@messaging-lab/shared';

import {
  BROKER_LABELS,
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
}

export function RunHistory({
  runs,
  suites,
  selectedRunId,
  selectedSuiteId,
  onSelectRun,
  onSelectSuite,
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
                />
              ))}
              {standaloneRuns.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  selected={selectedRunId === run.id}
                  onSelect={onSelectRun}
                  standalone
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
    </section>
  );
}

function SuiteRows({
  suite,
  selectedSuiteId,
  selectedRunId,
  onSelectSuite,
  onSelectRun,
}: {
  readonly suite: Suite;
  readonly selectedSuiteId: string | null;
  readonly selectedRunId: string | null;
  readonly onSelectSuite: (suite: Suite) => void;
  readonly onSelectRun: (run: Run) => void;
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
      </tr>
      {suite.runs.map((item) =>
        item.run ? (
          <RunRow
            key={item.run.id}
            run={item.run}
            selected={selectedRunId === item.run.id}
            onSelect={onSelectRun}
            suiteChild
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
}: {
  readonly run: Run;
  readonly selected: boolean;
  readonly onSelect: (run: Run) => void;
  readonly suiteChild?: boolean;
  readonly standalone?: boolean;
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
          {BROKER_LABELS[run.configuration.broker]}
        </button>
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
    </tr>
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
