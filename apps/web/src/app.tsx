import { useCallback, useEffect, useState } from 'react';

import type {
  BrokerInfo,
  CreateSuiteRequest,
  Run,
  StartRunRequest,
  Suite,
} from '@messaging-lab/shared';

import { ApiClient, type DashboardApi } from './api/client.js';
import { BrokerOverview } from './components/broker-overview.js';
import { CapabilityMatrix } from './components/capability-matrix.js';
import { ComparisonCharts } from './components/comparison-charts.js';
import { ExperimentForm } from './components/experiment-form.js';
import { RunDetail } from './components/run-detail.js';
import { RunHistory } from './components/run-history.js';
import { SuiteDetail } from './components/suite-detail.js';
import { useRunLifecycle } from './hooks/use-run-lifecycle.js';
import { useSuiteLifecycle } from './hooks/use-suite-lifecycle.js';

const defaultApi = new ApiClient();

type Selection =
  | { readonly kind: 'run'; readonly id: string }
  | { readonly kind: 'suite'; readonly id: string }
  | null;

export function App({ api = defaultApi }: { readonly api?: DashboardApi }) {
  const [brokers, setBrokers] = useState<BrokerInfo[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const refreshRuns = useCallback(async () => {
    const nextRuns = await api.getRuns();
    setRuns(nextRuns);
    return nextRuns;
  }, [api]);
  const refreshSuites = useCallback(async () => {
    const nextSuites = await api.getSuites();
    setSuites(nextSuites);
    return nextSuites;
  }, [api]);
  const reportError = useCallback((error: unknown) => {
    setPageError(errorMessage(error));
  }, []);
  const addRun = useCallback((run: Run) => {
    setRuns((current) => [run, ...current.filter(({ id }) => id !== run.id)]);
  }, []);
  const upsertSuite = useCallback((suite: Suite) => {
    setSuites((current) => [
      suite,
      ...current.filter(({ id }) => id !== suite.id),
    ]);
  }, []);

  const {
    selectedRun,
    progress,
    disconnected: runDisconnected,
    launchRun,
    cancelRun,
    selectRun,
  } = useRunLifecycle({
    api,
    refreshRuns,
    addRun,
    onError: reportError,
    onTerminal: () => undefined,
  });
  const {
    selectedSuite,
    disconnected: suiteDisconnected,
    launchSuite,
    cancelSuite,
    selectSuite,
  } = useSuiteLifecycle({
    api,
    refreshSuites,
    upsertSuite,
    refreshRuns,
    onError: reportError,
  });

  const displayRun = useCallback(
    (run: Run, updateUrl = true) => {
      selectRun(run);
      setSelection({ kind: 'run', id: run.id });
      if (updateUrl) writeSelection('run', run.id);
    },
    [selectRun],
  );
  const displaySuite = useCallback(
    (suite: Suite, updateUrl = true) => {
      selectSuite(suite);
      setSelection({ kind: 'suite', id: suite.id });
      if (updateUrl) writeSelection('suite', suite.id);
    },
    [selectSuite],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [nextBrokers, nextRuns, nextSuites] = await Promise.all([
          api.getBrokers(),
          api.getRuns(),
          api.getSuites(),
        ]);
        if (!active) return;
        setBrokers(nextBrokers);
        setRuns(nextRuns);
        setSuites(nextSuites);

        const urlSelection = readSelection();
        if (urlSelection?.kind === 'suite') {
          const suite =
            nextSuites.find(({ id }) => id === urlSelection.id) ??
            (await api.getSuite(urlSelection.id));
          if (active) displaySuite(suite, false);
          return;
        }
        if (urlSelection?.kind === 'run') {
          const run =
            nextRuns.find(({ id }) => id === urlSelection.id) ??
            (await api.getRun(urlSelection.id));
          if (active) displayRun(run, false);
          return;
        }

        const activeSuite = nextSuites.find(isActiveSuite);
        if (activeSuite) {
          displaySuite(activeSuite);
          return;
        }
        const activeRun = nextRuns.find(isActiveRun);
        if (activeRun) displayRun(activeRun);
      } catch (error) {
        if (active) setPageError(errorMessage(error));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [api, displayRun, displaySuite]);

  async function startRun(request: StartRunRequest): Promise<void> {
    setPageError(null);
    const run = await launchRun(request);
    if (run) {
      setSelection({ kind: 'run', id: run.id });
      writeSelection('run', run.id);
    }
  }

  async function startSuite(request: CreateSuiteRequest): Promise<void> {
    setPageError(null);
    const suite = await launchSuite(request);
    if (suite) {
      setSelection({ kind: 'suite', id: suite.id });
      writeSelection('suite', suite.id);
    }
  }

  const activeRun = runs.some(isActiveRun);
  const activeSuite = suites.some(isActiveSuite);
  const controlsDisabled = activeRun || activeSuite;
  const showingSuite =
    selection?.kind === 'suite' && selectedSuite?.id === selection.id;
  const showingRun =
    selection?.kind === 'run' && selectedRun?.id === selection.id;

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
              <ExperimentForm
                disabled={controlsDisabled}
                onStart={startRun}
                onStartSuite={startSuite}
              />
              {showingSuite && selectedSuite ? (
                <SuiteDetail
                  suite={selectedSuite}
                  disconnected={suiteDisconnected}
                  onCancel={cancelSuite}
                  onSelectRun={displayRun}
                />
              ) : (
                <RunDetail
                  run={showingRun ? selectedRun : null}
                  progress={progress}
                  disconnected={runDisconnected}
                  onCancel={cancelRun}
                />
              )}
            </div>
            <div id="history">
              <RunHistory
                runs={runs}
                suites={suites}
                selectedRunId={selection?.kind === 'run' ? selection.id : null}
                selectedSuiteId={
                  selection?.kind === 'suite' ? selection.id : null
                }
                onSelectRun={displayRun}
                onSelectSuite={displaySuite}
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

function isActiveRun(run: Run): boolean {
  return run.status === 'pending' || run.status === 'running';
}

function isActiveSuite(suite: Suite): boolean {
  return suite.status === 'pending' || suite.status === 'running';
}

function readSelection(): Selection {
  const parameters = new URLSearchParams(window.location.search);
  const suiteId = parameters.get('suite');
  if (suiteId) return { kind: 'suite', id: suiteId };
  const runId = parameters.get('run');
  return runId ? { kind: 'run', id: runId } : null;
}

function writeSelection(kind: 'run' | 'suite', id: string): void {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set(kind, id);
  window.history.replaceState(null, '', url);
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'An unexpected error occurred.';
}
