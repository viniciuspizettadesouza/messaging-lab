import { useCallback, useEffect, useRef, useState } from 'react';

import type { Run, RunEvent, StartRunRequest } from '@messaging-lab/shared';

import type { DashboardApi } from '../api/client.js';

const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'timed-out',
  'cancelled',
]);

interface UseRunLifecycleOptions {
  readonly api: DashboardApi;
  readonly refreshRuns: () => Promise<Run[]>;
  readonly addRun: (run: Run) => void;
  readonly onError: (error: unknown) => void;
  readonly onTerminal: () => void;
}

export function useRunLifecycle({
  api,
  refreshRuns,
  addRun,
  onError,
  onTerminal,
}: UseRunLifecycleOptions) {
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [progress, setProgress] = useState<Extract<
    RunEvent,
    { type: 'progress' }
  > | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const selectedRunRef = useRef<Run | null>(null);
  selectedRunRef.current = selectedRun;
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const onTerminalRef = useRef(onTerminal);
  onTerminalRef.current = onTerminal;

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
        onError(error);
      } finally {
        onTerminalRef.current();
      }
    },
    [api, onError, refreshRuns, stopSubscription],
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
            if (TERMINAL_STATUSES.has(event.status)) void finishRun(runId);
          }
        },
      });
    },
    [api, finishRun, stopSubscription],
  );

  const launchRun = useCallback(
    async (request: StartRunRequest): Promise<Run | null> => {
      setProgress(null);
      setDisconnected(false);
      try {
        const run = await api.startRun(request);
        setSelectedRun(run);
        addRun(run);
        watchRun(run.id);
        return run;
      } catch (error) {
        onError(error);
        return null;
      }
    },
    [addRun, api, onError, watchRun],
  );

  const cancelRun = useCallback(async () => {
    if (!selectedRun) return;
    try {
      await api.cancelRun(selectedRun.id);
    } catch (error) {
      onError(error);
    }
  }, [api, onError, selectedRun]);

  const selectRun = useCallback(
    (run: Run) => {
      if (run.id !== selectedRunRef.current?.id) {
        stopSubscription();
        setProgress(null);
        setDisconnected(false);
      }
      setSelectedRun(run);
      if (run.status === 'pending' || run.status === 'running')
        watchRun(run.id);
    },
    [stopSubscription, watchRun],
  );

  useEffect(() => stopSubscription, [stopSubscription]);

  return {
    selectedRun,
    progress,
    disconnected,
    launchRun,
    cancelRun,
    selectRun,
    watchRun,
  };
}
