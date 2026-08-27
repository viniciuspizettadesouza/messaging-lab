import { describe, expect, it } from 'vitest';

import {
  comparisonTrackFor,
  type BrokerId,
  type Run,
  type ScenarioId,
} from '@messaging-lab/shared';

import { createRun } from '../test/fixtures.js';
import {
  comparisonGroupFor,
  latestCompletedRuns,
  runKey,
  selectComparisonGroups,
} from './comparison.js';

describe('comparison selectors', () => {
  it('selects only the newest completed result with metrics per combination', () => {
    const older = result('kafka', 'fan-out', '2026-08-18T10:00:00.000Z', 1);
    const newer = result('kafka', 'fan-out', '2026-08-18T11:00:00.000Z', 2);
    const failed = {
      ...result('redis', 'fan-out', '2026-08-18T12:00:00.000Z', 3),
      status: 'failed' as const,
      metrics: null,
    };

    expect(
      latestCompletedRuns([older, failed, newer]).get(
        runKey('kafka', 'fan-out'),
      )?.id,
    ).toBe(newer.id);
    expect(latestCompletedRuns([older, failed, newer])).toHaveLength(1);
  });

  it('keeps ephemeral and durable semantics in separate groups', () => {
    const redisPubSub = result(
      'redis',
      'fan-out',
      '2026-08-18T10:00:00.000Z',
      1,
    );
    const kafkaFanOut = result(
      'kafka',
      'fan-out',
      '2026-08-18T10:00:00.000Z',
      2,
    );
    const rabbitWorkers = result(
      'rabbitmq',
      'competing-consumers',
      '2026-08-18T10:00:00.000Z',
      3,
    );

    expect(comparisonGroupFor(redisPubSub)).toBe('ephemeral-baseline');
    expect(
      selectComparisonGroups([redisPubSub, kafkaFanOut, rabbitWorkers]),
    ).toEqual({
      primaryFanOut: [kafkaFanOut],
      primaryCompetingConsumers: [rabbitWorkers],
      adjacentStreaming: [],
      ephemeralBaseline: [redisPubSub],
    });
  });
});

function result(
  broker: BrokerId,
  scenario: ScenarioId,
  createdAt: string,
  index: number,
): Run {
  return {
    ...createRun('completed'),
    id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    configuration: { ...createRun().configuration, broker, scenario },
    comparisonTrack: comparisonTrackFor(broker, scenario),
    createdAt,
  };
}
