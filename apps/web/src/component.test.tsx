// @vitest-environment jsdom

import './test/setup.js';

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { BrokerId, Run, ScenarioId } from '@messaging-lab/shared';

import { App } from './app.js';
import type { DashboardApi } from './api/client.js';
import { ComparisonCharts } from './components/comparison-charts.js';
import { RunDetail } from './components/run-detail.js';
import { brokers, createRun } from './test/fixtures.js';

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
});

function staticApi(): DashboardApi {
  return {
    getBrokers: vi.fn(async () => brokers),
    getRuns: vi.fn(async () => []),
    getRun: vi.fn(async () => createRun('completed')),
    startRun: vi.fn(async () => createRun('pending')),
    cancelRun: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => undefined),
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
