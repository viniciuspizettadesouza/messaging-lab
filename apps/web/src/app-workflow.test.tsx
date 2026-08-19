// @vitest-environment jsdom

import './test/setup.js';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Run, RunEvent, SuiteEvent } from '@messaging-lab/shared';

import type {
  DashboardApi,
  RunEventHandlers,
  SuiteEventHandlers,
} from './api/client.js';
import { App } from './app.js';
import {
  brokers,
  createRun,
  createSuite,
  runId,
  suiteId,
  timestamp,
} from './test/fixtures.js';

describe('dashboard workflows', () => {
  it('shows loading and then the empty experiment states', async () => {
    let resolveRuns!: (runs: Run[]) => void;
    const runs = new Promise<Run[]>((resolve) => {
      resolveRuns = resolve;
    });
    const api = createApi({ getRuns: vi.fn(() => runs) });
    render(<App api={api} />);

    expect(screen.getByText('Connecting to the lab…')).toBeInTheDocument();
    resolveRuns([]);

    expect(await screen.findByText('No experiments yet.')).toBeInTheDocument();
    expect(screen.getByText('No comparable results yet.')).toBeInTheDocument();
    expect(screen.getByText('No experiment selected')).toBeInTheDocument();
  });

  it('starts a standalone run and applies live completion events', async () => {
    const pending = createRun('pending');
    const completed = createRun('completed');
    const api = createApi({
      startRun: vi.fn(async () => pending),
      getRun: vi.fn(async () => completed),
      getRuns: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([completed]),
    });
    render(<App api={api} />);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole('button', { name: 'Start standalone run' }),
    );
    expect(api.startRun).toHaveBeenCalledWith(
      expect.objectContaining({ broker: 'redis', scenario: 'fan-out' }),
    );
    expect(window.location.search).toBe(`?run=${runId}`);

    api.emitRun({
      type: 'progress',
      runId,
      sequence: 2,
      timestamp,
      phase: 'publishing',
      completedUnits: 5,
      totalUnits: 10,
      publishedMessages: 5,
      receivedMessages: 4,
    });
    expect(await screen.findByText('50%')).toBeInTheDocument();
    api.emitRun({
      type: 'status',
      runId,
      sequence: 3,
      timestamp,
      status: 'completed',
    });

    expect((await screen.findAllByText('500 msg/s')).length).toBeGreaterThan(0);
  });

  it('creates one server-managed suite and renders live aggregate progress', async () => {
    const pending = createSuite('pending');
    const completed = createSuite('completed', ['completed', 'failed']);
    const api = createApi({
      startSuite: vi.fn(async () => pending),
      getSuite: vi.fn(async () => completed),
      getSuites: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([completed]),
      getRuns: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(
          completed.runs.flatMap(({ run }) => (run ? [run] : [])),
        ),
    });
    render(<App api={api} />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Start benchmark suite' }),
    );
    expect(api.startSuite).toHaveBeenCalledTimes(1);
    expect(api.startSuite).toHaveBeenCalledWith(
      expect.objectContaining({
        repetitions: 3,
        orderStrategy: 'fixed',
        cooldownMs: 1_000,
        combinations: expect.arrayContaining([
          { broker: 'redis', scenario: 'fan-out' },
          { broker: 'rabbitmq', scenario: 'competing-consumers' },
        ]),
      }),
    );
    expect(window.location.search).toBe(`?suite=${suiteId}`);

    api.emitSuite({
      type: 'progress',
      suiteId,
      sequence: 3,
      timestamp,
      progress: {
        completedRuns: 1,
        totalRuns: 2,
        currentPosition: 1,
        currentCombination: {
          broker: 'kafka',
          scenario: 'competing-consumers',
        },
        currentRepetition: 1,
        activeRunId: runId,
      },
    });
    expect(await screen.findByText('1/2 finished')).toBeInTheDocument();
    expect(screen.getByText('1 remaining')).toBeInTheDocument();
    expect(
      screen.getAllByText(/Kafka · Competing consumers/).length,
    ).toBeGreaterThan(0);

    api.emitSuite({
      type: 'status',
      suiteId,
      sequence: 4,
      timestamp,
      status: 'completed',
    });
    const summary = await screen.findByLabelText('Suite trial summary');
    expect(within(summary).getByText('Failed')).toBeInTheDocument();
    expect(within(summary).getAllByText('1')).toHaveLength(2);
    expect(screen.getByText('Broker unavailable.')).toBeInTheDocument();
  });

  it('restores an active suite after reload and cancels it through the suite API', async () => {
    const running = createSuite('running', ['running']);
    const api = createApi({ getSuites: vi.fn(async () => [running]) });
    render(<App api={api} />);

    expect(
      await screen.findByRole('heading', { name: running.name }),
    ).toBeInTheDocument();
    expect(api.subscribeSuite).toHaveBeenCalledWith(suiteId, expect.anything());
    expect(window.location.search).toBe(`?suite=${suiteId}`);
    api.disconnectSuite();
    expect(
      await screen.findByText('Live suite connection lost'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel suite' }));
    expect(api.cancelSuite).toHaveBeenCalledWith(suiteId);
  });

  it('restores stable suite URLs and links suite trials to stable run URLs', async () => {
    const completed = createSuite('completed', ['completed', 'failed']);
    window.history.replaceState(null, '', `/?suite=${completed.id}`);
    const api = createApi({
      getSuites: vi.fn(async () => [completed]),
      getRuns: vi.fn(async () =>
        completed.runs.flatMap(({ run }) => (run ? [run] : [])),
      ),
    });
    render(<App api={api} />);

    expect(
      await screen.findByRole('heading', { name: completed.name }),
    ).toBeInTheDocument();
    const executionOrder = screen.getByText('Execution order').parentElement!;
    await userEvent.click(within(executionOrder).getAllByRole('button')[0]!);
    expect(window.location.search).toMatch(/^\?run=/);
    expect(
      screen.getByRole('heading', { name: /Redis · Live fan-out/ }),
    ).toBeInTheDocument();
  });
});

interface FakeApi extends DashboardApi {
  emitRun(event: RunEvent): void;
  emitSuite(event: SuiteEvent): void;
  disconnectRun(): void;
  disconnectSuite(): void;
}

function createApi(overrides: Partial<DashboardApi> = {}): FakeApi {
  let runHandlers: RunEventHandlers | null = null;
  let suiteHandlers: SuiteEventHandlers | null = null;
  return {
    getBrokers: vi.fn(async () => brokers),
    getRuns: vi.fn(async () => []),
    getRun: vi.fn(async () => createRun('completed')),
    startRun: vi.fn(async () => createRun('pending')),
    cancelRun: vi.fn(async () => undefined),
    subscribe: vi.fn((_id, handlers) => {
      runHandlers = handlers;
      return () => {
        runHandlers = null;
      };
    }),
    getSuites: vi.fn(async () => []),
    getSuite: vi.fn(async () =>
      createSuite('completed', ['completed', 'completed']),
    ),
    startSuite: vi.fn(async () => createSuite('pending')),
    cancelSuite: vi.fn(async () => undefined),
    subscribeSuite: vi.fn((_id, handlers) => {
      suiteHandlers = handlers;
      return () => {
        suiteHandlers = null;
      };
    }),
    ...overrides,
    emitRun(event) {
      runHandlers?.onEvent(event);
    },
    emitSuite(event) {
      suiteHandlers?.onEvent(event);
    },
    disconnectRun() {
      runHandlers?.onDisconnect();
    },
    disconnectSuite() {
      suiteHandlers?.onDisconnect();
    },
  };
}
