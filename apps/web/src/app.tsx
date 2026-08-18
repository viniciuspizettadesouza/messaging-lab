import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  BrokerInfo,
  Run,
  RunEvent,
  StartRunRequest,
} from '@messaging-lab/shared';

import { ApiClient, type DashboardApi } from './api/client.js';
import { BrokerOverview } from './components/broker-overview.js';
import { CapabilityMatrix } from './components/capability-matrix.js';
import { ComparisonCharts } from './components/comparison-charts.js';
import { ExperimentForm } from './components/experiment-form.js';
import { RunDetail } from './components/run-detail.js';
import { RunHistory } from './components/run-history.js';

const defaultApi = new ApiClient();
const terminalStatuses = new Set([
  'completed',
  'failed',
  'timed-out',
  'cancelled',
]);

export function App({ api = defaultApi }: { readonly api?: DashboardApi }) {
  const [brokers, setBrokers] = useState<BrokerInfo[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [progress, setProgress] = useState<Extract<
    RunEvent,
    { type: 'progress' }
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const refreshRuns = useCallback(async () => {
    const nextRuns = await api.getRuns();
    setRuns(nextRuns);
    return nextRuns;
  }, [api]);

  const stopSubscription = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }, []);

  const finishRun = useCallback(
    async (runId: string) => {
      stopSubscription();
      try {
        const [run] = await Promise.all([api.getRun(runId), refreshRuns()]);
        setSelectedRun(run);
      } catch (error) {
        setPageError(errorMessage(error));
      }
    },
    [api, refreshRuns, stopSubscription],
  );

  const watchRun = useCallback(
    (runId: string) => {
      stopSubscription();
      setDisconnected(false);
      unsubscribeRef.current = api.subscribe(runId, {
        onDisconnect: () => setDisconnected(true),
        onEvent: (event) => {
          if (event.type === 'progress') setProgress(event);
          if (event.type === 'metrics') {
            setSelectedRun((current) =>
              current ? { ...current, metrics: event.metrics } : current,
            );
          }
          if (event.type === 'error') {
            setSelectedRun((current) =>
              current
                ? { ...current, errors: [...current.errors, event.error] }
                : current,
            );
          }
          if (event.type === 'status') {
            setSelectedRun((current) =>
              current ? { ...current, status: event.status } : current,
            );
            if (terminalStatuses.has(event.status)) void finishRun(runId);
          }
        },
      });
    },
    [api, finishRun, stopSubscription],
  );

  useEffect(() => {
    let active = true;
    void Promise.all([api.getBrokers(), api.getRuns()])
      .then(([nextBrokers, nextRuns]) => {
        if (!active) return;
        setBrokers(nextBrokers);
        setRuns(nextRuns);
        const activeRun = nextRuns.find(
          (run) => run.status === 'pending' || run.status === 'running',
        );
        if (activeRun) {
          setSelectedRun(activeRun);
          watchRun(activeRun.id);
        }
      })
      .catch((error: unknown) => {
        if (active) setPageError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      stopSubscription();
    };
  }, [api, stopSubscription, watchRun]);

  async function startRun(request: StartRunRequest): Promise<void> {
    setPageError(null);
    setProgress(null);
    setDisconnected(false);
    try {
      const run = await api.startRun(request);
      setSelectedRun(run);
      setRuns((current) => [run, ...current.filter(({ id }) => id !== run.id)]);
      watchRun(run.id);
    } catch (error) {
      setPageError(errorMessage(error));
    }
  }

  async function cancelRun(): Promise<void> {
    if (!selectedRun) return;
    try {
      await api.cancelRun(selectedRun.id);
    } catch (error) {
      setPageError(errorMessage(error));
    }
  }

  function selectRun(run: Run): void {
    if (run.id !== selectedRun?.id) {
      stopSubscription();
      setProgress(null);
      setDisconnected(false);
    }
    setSelectedRun(run);
    if (run.status === 'pending' || run.status === 'running') watchRun(run.id);
  }

  const active =
    selectedRun?.status === 'pending' || selectedRun?.status === 'running';

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Messaging Lab home">
          <span className="brand-symbol" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            Messaging <strong>Lab</strong>
          </span>
        </a>
        <nav aria-label="Page sections">
          <a href="#experiment">Experiment</a>
          <a href="#history">History</a>
          <a href="#capabilities">Capabilities</a>
        </nav>
        <span className="local-chip">
          <span />
          Local environment
        </span>
      </header>

      <main id="top">
        <section className="hero">
          <div>
            <p className="eyebrow">Messaging systems, made observable</p>
            <h1>
              Compare behavior.
              <br />
              <em>Understand trade-offs.</em>
            </h1>
            <p className="hero-copy">
              Run the same workload through Redis, Kafka, and RabbitMQ. Measure
              the result while keeping each broker's semantics visible.
            </p>
          </div>
          <div className="hero-diagram" aria-hidden="true">
            <span className="pulse-node producer">P</span>
            <i />
            <span className="pulse-node broker">B</span>
            <i />
            <span className="pulse-node consumer">C</span>
          </div>
        </section>

        {pageError ? (
          <div className="global-error" role="alert">
            <strong>Dashboard error</strong>
            <span>{pageError}</span>
            <button type="button" onClick={() => setPageError(null)}>
              Dismiss
            </button>
          </div>
        ) : null}

        {loading ? (
          <section className="loading-state" aria-live="polite">
            <span className="spinner" />
            <strong>Connecting to the lab…</strong>
            <p>Loading broker health and experiment history.</p>
          </section>
        ) : (
          <>
            <BrokerOverview brokers={brokers} />
            <div className="workspace-grid" id="experiment">
              <ExperimentForm disabled={Boolean(active)} onStart={startRun} />
              <RunDetail
                run={selectedRun}
                progress={progress}
                disconnected={disconnected}
                onCancel={cancelRun}
              />
            </div>
            <div id="history">
              <RunHistory
                runs={runs}
                selectedRunId={selectedRun?.id ?? null}
                onSelect={selectRun}
              />
            </div>
            <ComparisonCharts runs={runs} />
            <div id="capabilities">
              <CapabilityMatrix />
            </div>
          </>
        )}
      </main>
      <footer>
        <span>Messaging Lab</span>
        <p>
          Local benchmarks are evidence about your setup, not universal
          rankings.
        </p>
      </footer>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'An unexpected error occurred.';
}
