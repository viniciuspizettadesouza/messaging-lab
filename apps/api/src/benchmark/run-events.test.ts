import { describe, expect, it } from 'vitest';

import { runEventSchema } from '@messaging-lab/shared';

import { formatSseEvent, RunEventStore } from './run-events.js';

describe('RunEventStore', () => {
  it('sequences, retains, and publishes events', () => {
    const store = new RunEventStore(2);
    const runId = '11111111-1111-4111-8111-111111111111';
    const received: number[] = [];
    const unsubscribe = store.subscribe(runId, (event) => {
      received.push(event.sequence);
    });

    store.publish(runId, { type: 'status', status: 'pending' });
    store.publish(runId, { type: 'status', status: 'running' });
    const completed = store.publish(runId, {
      type: 'status',
      status: 'completed',
    });
    unsubscribe();

    expect(received).toEqual([0, 1, 2]);
    expect(store.history(runId).map(({ sequence }) => sequence)).toEqual([
      1, 2,
    ]);
    expect(runEventSchema.parse(completed)).toEqual(completed);
    expect(formatSseEvent(completed)).toContain('event: status\n');
  });
});
