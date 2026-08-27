import { describe, expect, it } from 'vitest';

import { BENCHMARK_DEFAULTS } from '@messaging-lab/shared';

import { mapRunRows, type RunRow } from './run-row-mappers.js';

const row: RunRow = {
  id: '11111111-1111-4111-8111-111111111111',
  name: null,
  description: null,
  broker: 'redis',
  scenario: 'competing-consumers',
  message_count: BENCHMARK_DEFAULTS.messageCount,
  payload_size_bytes: BENCHMARK_DEFAULTS.payloadSizeBytes,
  producer_concurrency: BENCHMARK_DEFAULTS.producerConcurrency,
  consumer_count: BENCHMARK_DEFAULTS.consumerCount,
  timeout_ms: BENCHMARK_DEFAULTS.timeoutMs,
  status: 'failed',
  created_at: '2026-08-18T12:00:00.000Z',
  started_at: '2026-08-18T12:00:00.000Z',
  finished_at: '2026-08-18T12:00:01.000Z',
};

describe('run row mapping', () => {
  it('maps storage names and parses error details through the runtime schema', () => {
    expect(
      mapRunRows(
        row,
        undefined,
        [{ note: 'Retained stream.' }],
        [
          {
            code: 'BROKER_ERROR',
            message: 'Unavailable.',
            occurred_at: '2026-08-18T12:00:01.000Z',
            details_json: '{"retryable":true}',
          },
        ],
      ),
    ).toMatchObject({
      comparisonTrack: 'adjacent-streaming',
      configuration: { messageCount: BENCHMARK_DEFAULTS.messageCount },
      notes: ['Retained stream.'],
      errors: [{ details: { retryable: true } }],
    });
  });

  it('rejects non-object persisted error details', () => {
    expect(() =>
      mapRunRows(
        row,
        undefined,
        [],
        [
          {
            code: 'BROKER_ERROR',
            message: 'Unavailable.',
            occurred_at: '2026-08-18T12:00:01.000Z',
            details_json: '[]',
          },
        ],
      ),
    ).toThrow('must be a JSON object');
  });
});
