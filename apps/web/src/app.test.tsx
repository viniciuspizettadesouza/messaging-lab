// @vitest-environment jsdom

import './test/setup.js';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  startRunRequestSchema,
  type Run,
  type RunEvent,
  type StartRunRequest,
} from '@messaging-lab/shared';

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

  it('runs every broker and scenario sequentially as one suite', async () => {
    const startedRuns: Run[] = [];
    const api = createApi({
      startRun: vi.fn(async (request: StartRunRequest) => {
        const configuration = startRunRequestSchema.parse(request);
        const run = {
          ...createRun('pending'),
          id: suiteRunId(startedRuns.length + 1),
          configuration,
        };
        startedRuns.push(run);
        return run;
      }),
      getRun: vi.fn(async (id: string) => ({
        ...(startedRuns.find((run) => run.id === id) ?? createRun()),
        status: 'completed' as const,
      })),
      getRuns: vi.fn(async () => []),
    });
    render(<App api={api} />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Run all 6 sequentially' }),
    );

    const expectedOrder = [
      ['redis', 'fan-out'],
      ['redis', 'competing-consumers'],
      ['kafka', 'fan-out'],
      ['kafka', 'competing-consumers'],
      ['rabbitmq', 'fan-out'],
      ['rabbitmq', 'competing-consumers'],
    ];

    for (const [index, expected] of expectedOrder.entries()) {
      await waitFor(() =>
        expect(api.startRun).toHaveBeenCalledTimes(index + 1),
      );
      expect(api.startRun).toHaveBeenNthCalledWith(
        index + 1,
        expect.objectContaining({ broker: expected[0], scenario: expected[1] }),
      );
      api.emit({
        type: 'status',
        runId: startedRuns[index]!.id,
        sequence: index,
        timestamp,
        status: 'completed',
      });
    }

    expect(await screen.findByText('Suite complete')).toBeInTheDocument();
    expect(screen.getByText('6/6 finished')).toBeInTheDocument();
  });

  it('stops the remaining suite queue when the active run is cancelled', async () => {
    const api = createApi();
    render(<App api={api} />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Run all 6 sequentially' }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Cancel run' }),
    );
    api.emit({
      type: 'status',
      runId,
      sequence: 1,
      timestamp,
      status: 'cancelled',
    });

    expect(await screen.findByText('Suite stopped')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(api.startRun).toHaveBeenCalledTimes(1);
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

  it('shows supported and unsupported broker capabilities explicitly', async () => {
    const api = createApi();
    render(<App api={api} />);

    expect(
      await screen.findByRole('heading', { name: 'Capability matrix' }),
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText('Supported')).toHaveLength(18);
    expect(screen.getAllByLabelText('Unsupported')).toHaveLength(6);
    expect(
      screen.getByText(/RabbitMQ removes acknowledged messages/),
    ).toBeInTheDocument();
  });
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

function suiteRunId(index: number): string {
  return `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`;
}
