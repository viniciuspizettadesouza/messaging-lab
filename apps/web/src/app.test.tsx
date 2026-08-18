// @vitest-environment jsdom

import './test/setup.js';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Run, RunEvent } from '@messaging-lab/shared';

import type { DashboardApi, RunEventHandlers } from './api/client.js';
import { App } from './app.js';
import { RunDetail } from './components/run-detail.js';
import { brokers, createRun, runId, timestamp } from './test/fixtures.js';

describe('dashboard', () => {
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

  it('starts an experiment and applies live progress and completion events', async () => {
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
      await screen.findByRole('button', { name: 'Start experiment' }),
    );
    expect(api.startRun).toHaveBeenCalledWith(
      expect.objectContaining({ broker: 'redis', scenario: 'fan-out' }),
    );
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);

    api.emit({
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
    api.emit({
      type: 'status',
      runId,
      sequence: 3,
      timestamp,
      status: 'completed',
    });

    expect((await screen.findAllByText('500 msg/s')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
  });

  it('offers cancellation and reports a disconnected live stream', async () => {
    const running = createRun('running');
    const api = createApi({ getRuns: vi.fn(async () => [running]) });
    render(<App api={api} />);

    expect((await screen.findAllByText('Running')).length).toBeGreaterThan(0);
    api.disconnect();
    expect(await screen.findByText('Live connection lost')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    expect(api.cancelRun).toHaveBeenCalledWith(runId);
  });

  it.each(['completed', 'failed', 'timed-out', 'cancelled'] as const)(
    'renders the %s terminal state',
    (status) => {
      render(
        <RunDetail
          run={createRun(status)}
          progress={null}
          disconnected={false}
          onCancel={vi.fn()}
        />,
      );
      expect(
        screen.getByText(
          status === 'timed-out' ? 'Timed out' : capitalize(status),
        ),
      ).toBeInTheDocument();
    },
  );
});

interface FakeApi extends DashboardApi {
  emit(event: RunEvent): void;
  disconnect(): void;
}

function createApi(overrides: Partial<DashboardApi> = {}): FakeApi {
  let handlers: RunEventHandlers | null = null;
  return {
    getBrokers: vi.fn(async () => brokers),
    getRuns: vi.fn(async () => []),
    getRun: vi.fn(async () => createRun('completed')),
    startRun: vi.fn(async () => createRun('pending')),
    cancelRun: vi.fn(async () => undefined),
    subscribe: vi.fn((_id, nextHandlers) => {
      handlers = nextHandlers;
      return () => {
        handlers = null;
      };
    }),
    ...overrides,
    emit(event) {
      handlers?.onEvent(event);
    },
    disconnect() {
      handlers?.onDisconnect();
    },
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
