// @vitest-environment jsdom

import './test/setup.js';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { BrokerId, Run, ScenarioId } from '@messaging-lab/shared';

import { App } from './app.js';
import type { DashboardApi } from './api/client.js';
import { ComparisonCharts } from './components/comparison-charts.js';
import { ExperimentForm } from './components/experiment-form.js';
import { RunDetail } from './components/run-detail.js';
import { RunHistory } from './components/run-history.js';
import { SuiteDetail } from './components/suite-detail.js';
import { brokers, createRun, createSuite } from './test/fixtures.js';

describe('dashboard components', () => {
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
    render(<App api={staticApi()} />);
    expect(
      await screen.findByRole('heading', { name: 'Capability matrix' }),
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText('Supported')).toHaveLength(18);
    expect(screen.getAllByLabelText('Unsupported')).toHaveLength(6);
    expect(
      screen.getByText(/RabbitMQ removes acknowledged messages/),
    ).toBeInTheDocument();
  });

  it('separates Redis Pub/Sub from durable performance comparisons', () => {
    render(
      <ComparisonCharts
        runs={[
          comparisonRun('redis', 'fan-out', 1),
          comparisonRun('redis', 'competing-consumers', 2),
          comparisonRun('kafka', 'fan-out', 3),
          comparisonRun('kafka', 'competing-consumers', 4),
          comparisonRun('rabbitmq', 'fan-out', 5),
          comparisonRun('rabbitmq', 'competing-consumers', 6),
        ]}
      />,
    );

    const baseline = screen.getByLabelText('Ephemeral live baseline');
    expect(within(baseline).getByText('Redis Pub/Sub')).toBeInTheDocument();
    expect(
      within(baseline).getByText(/excluded from the durable/),
    ).toBeInTheDocument();
    const fanOut = screen.getByLabelText('Durable fan-out comparison');
    expect(within(fanOut).getAllByText('Kafka')).toHaveLength(2);
    expect(within(fanOut).getAllByText('RabbitMQ')).toHaveLength(2);
    expect(within(fanOut).queryByText('Redis')).not.toBeInTheDocument();
    const competing = screen.getByLabelText(
      'Durable competing-consumer comparison',
    );
    expect(within(competing).getAllByText('Redis')).toHaveLength(2);
    expect(within(competing).getAllByText('Kafka')).toHaveLength(2);
    expect(within(competing).getAllByText('RabbitMQ')).toHaveLength(2);
  });

  it('configures suite combinations, repetitions, order, and cooldown', async () => {
    const onStartSuite = vi.fn(async () => undefined);
    render(
      <ExperimentForm
        disabled={false}
        onStart={vi.fn(async () => undefined)}
        onStartSuite={onStartSuite}
      />,
    );
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('checkbox', {
        name: 'Redis · Live fan-out',
      }),
    );
    const repetitions = screen.getByRole('spinbutton', {
      name: /Repetitions/,
    });
    const cooldown = screen.getByRole('spinbutton', {
      name: /Cooldown \(ms\)/,
    });
    await user.clear(repetitions);
    await user.type(repetitions, '2');
    await user.selectOptions(
      screen.getByRole('combobox', { name: /Order/ }),
      'randomized',
    );
    await user.clear(cooldown);
    await user.type(cooldown, '500');
    await user.click(
      screen.getByRole('button', { name: 'Start benchmark suite' }),
    );

    expect(onStartSuite).toHaveBeenCalledWith(
      expect.objectContaining({
        repetitions: 2,
        orderStrategy: 'randomized',
        cooldownMs: 500,
        combinations: expect.not.arrayContaining([
          { broker: 'redis', scenario: 'fan-out' },
        ]),
      }),
    );
  });

  it('shows unsuccessful suite trials and accessible overall progress', () => {
    const suite = createSuite('completed', ['failed', 'timed-out']);
    const { rerender } = render(
      <SuiteDetail
        suite={suite}
        disconnected={false}
        onCancel={vi.fn()}
        onSelectRun={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('progressbar', { name: 'Overall suite progress' }),
    ).toHaveAttribute('aria-valuetext', '2 of 2 runs finished');
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Timed out').length).toBeGreaterThan(0);
    expect(screen.getByText('Broker unavailable.')).toBeInTheDocument();

    rerender(
      <SuiteDetail
        suite={createSuite('cancelled', ['completed', 'cancelled'])}
        disconnected={false}
        onCancel={vi.fn()}
        onSelectRun={vi.fn()}
      />,
    );
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Too few successful trials/)).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Export JSON' })).toHaveAttribute(
      'href',
      expect.stringContaining('format=json'),
    );
  });

  it('groups suite runs and supports arrow-key history navigation', async () => {
    const suite = createSuite('completed', ['completed', 'failed']);
    const standalone = {
      ...createRun('completed'),
      id: '33333333-3333-4333-8333-333333333333',
    };
    render(
      <RunHistory
        runs={[
          ...suite.runs.map(({ run }) => run!).filter(Boolean),
          standalone,
        ]}
        suites={[suite]}
        selectedRunId={null}
        selectedSuiteId={null}
        onSelectRun={vi.fn()}
        onSelectSuite={vi.fn()}
      />,
    );
    const suiteLink = screen.getByRole('button', { name: suite.name });
    suiteLink.focus();
    await userEvent.keyboard('{ArrowDown}');

    expect(document.activeElement).toHaveTextContent('Redis');
    expect(screen.getByText('Standalone run')).toBeInTheDocument();
    expect(screen.getByText('Suite · 2 trials')).toBeInTheDocument();
  });
});

function staticApi(): DashboardApi {
  return {
    getBrokers: vi.fn(async () => brokers),
    getRuns: vi.fn(async () => []),
    getRun: vi.fn(async () => createRun('completed')),
    startRun: vi.fn(async () => createRun('pending')),
    cancelRun: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => undefined),
    getSuites: vi.fn(async () => []),
    getSuite: vi.fn(async () => createSuite('completed')),
    startSuite: vi.fn(async () => createSuite('pending')),
    cancelSuite: vi.fn(async () => undefined),
    subscribeSuite: vi.fn(() => () => undefined),
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function comparisonRun(
  broker: BrokerId,
  scenario: ScenarioId,
  index: number,
): Run {
  return {
    ...createRun('completed'),
    id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    configuration: {
      ...createRun('completed').configuration,
      broker,
      scenario,
    },
  };
}
