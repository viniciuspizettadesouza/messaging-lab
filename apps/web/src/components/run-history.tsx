import type { Run } from '@messaging-lab/shared';

import {
  BROKER_LABELS,
  SCENARIO_LABELS,
  formatDate,
  formatNumber,
} from '../format.js';
import { StatusBadge } from './status-badge.js';

interface RunHistoryProps {
  readonly runs: Run[];
  readonly selectedRunId: string | null;
  readonly onSelect: (run: Run) => void;
}

export function RunHistory({ runs, selectedRunId, onSelect }: RunHistoryProps) {
  return (
    <section className="section-block" aria-labelledby="history-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">SQLite history</p>
          <h2 id="history-heading">Recent experiments</h2>
        </div>
        <p>
          {runs.length} retained {runs.length === 1 ? 'run' : 'runs'}
        </p>
      </div>
      {runs.length === 0 ? (
        <div className="empty-row">
          <strong>No experiments yet.</strong>
          <span>Your first completed run will appear here.</span>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Broker</th>
                <th>Pattern</th>
                <th>Status</th>
                <th>Created</th>
                <th>Throughput</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  className={selectedRunId === run.id ? 'selected' : ''}
                  key={run.id}
                >
                  <td>
                    <button
                      className="table-link"
                      type="button"
                      onClick={() => onSelect(run)}
                    >
                      {BROKER_LABELS[run.configuration.broker]}
                    </button>
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
