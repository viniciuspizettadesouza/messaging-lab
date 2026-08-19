import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  CreateSuiteRequest,
  Suite,
  SuiteEvent,
} from '@messaging-lab/shared';

import type { DashboardApi } from '../api/client.js';

const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'stopped',
]);

interface UseSuiteLifecycleOptions {
  readonly api: DashboardApi;
  readonly refreshSuites: () => Promise<Suite[]>;
  readonly upsertSuite: (suite: Suite) => void;
  readonly refreshRuns: () => Promise<unknown>;
  readonly onError: (error: unknown) => void;
}

export function useSuiteLifecycle({
  api,
  refreshSuites,
  upsertSuite,
  refreshRuns,
  onError,
}: UseSuiteLifecycleOptions) {
  const [selectedSuite, setSelectedSuite] = useState<Suite | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const selectedSuiteRef = useRef<Suite | null>(null);
  selectedSuiteRef.current = selectedSuite;
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const finishingRef = useRef<string | null>(null);

  const stopSubscription = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }, []);

  const applySuite = useCallback(
    (suite: Suite) => {
      setSelectedSuite(suite);
      upsertSuite(suite);
    },
    [upsertSuite],
  );

  const refreshSuite = useCallback(
    async (suiteId: string) => {
      const suite = await api.getSuite(suiteId);
      applySuite(suite);
      return suite;
    },
    [api, applySuite],
  );

  const finishSuite = useCallback(
    async (suiteId: string) => {
      if (finishingRef.current === suiteId) return;
      finishingRef.current = suiteId;
      stopSubscription();
      try {
        const [suite] = await Promise.all([
          api.getSuite(suiteId),
          refreshSuites(),
          refreshRuns(),
        ]);
        applySuite(suite);
      } catch (error) {
        onError(error);
      } finally {
        finishingRef.current = null;
      }
    },
    [api, applySuite, onError, refreshRuns, refreshSuites, stopSubscription],
  );

  const handleEvent = useCallback(
    (suiteId: string, event: SuiteEvent) => {
      setDisconnected(false);
      if (event.type === 'progress') {
        setSelectedSuite((current) =>
          current?.id === suiteId
            ? { ...current, progress: event.progress }
            : current,
        );
      }
      if (event.type === 'summary') {
        setSelectedSuite((current) =>
          current?.id === suiteId
            ? { ...current, summary: event.summary }
            : current,
        );
      }
      if (event.type === 'error') {
        setSelectedSuite((current) =>
          current?.id === suiteId
            ? { ...current, errors: [...current.errors, event.error] }
            : current,
        );
      }
      if (event.type === 'run-event' && event.runEvent.type !== 'progress') {
        void refreshSuite(suiteId).catch(onError);
      }
      if (event.type === 'status') {
        setSelectedSuite((current) =>
          current?.id === suiteId
            ? { ...current, status: event.status }
            : current,
        );
        if (TERMINAL_STATUSES.has(event.status)) void finishSuite(suiteId);
      }
    },
    [finishSuite, onError, refreshSuite],
  );

  const watchSuite = useCallback(
    (suiteId: string) => {
      stopSubscription();
      setDisconnected(false);
      unsubscribeRef.current = api.subscribeSuite(suiteId, {
        onDisconnect: () => setDisconnected(true),
        onEvent: (event) => handleEvent(suiteId, event),
      });
    },
    [api, handleEvent, stopSubscription],
  );

  const launchSuite = useCallback(
    async (request: CreateSuiteRequest): Promise<Suite | null> => {
      setDisconnected(false);
      try {
        const suite = await api.startSuite(request);
        applySuite(suite);
        watchSuite(suite.id);
        return suite;
      } catch (error) {
        onError(error);
        return null;
      }
    },
    [api, applySuite, onError, watchSuite],
  );

  const cancelSuite = useCallback(async () => {
    if (!selectedSuite) return;
    try {
      await api.cancelSuite(selectedSuite.id);
    } catch (error) {
      onError(error);
    }
  }, [api, onError, selectedSuite]);

  const selectSuite = useCallback(
    (suite: Suite) => {
      if (suite.id !== selectedSuiteRef.current?.id) {
        stopSubscription();
        setDisconnected(false);
      }
      setSelectedSuite(suite);
      if (suite.status === 'pending' || suite.status === 'running') {
        watchSuite(suite.id);
      }
    },
    [stopSubscription, watchSuite],
  );

  useEffect(() => stopSubscription, [stopSubscription]);

  return {
    selectedSuite,
    disconnected,
    launchSuite,
    cancelSuite,
    selectSuite,
  };
}
