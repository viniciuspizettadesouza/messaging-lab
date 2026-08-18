import { describe, expect, it } from 'vitest';

import { decodeMessage, encodeMessage } from './message-codec.js';
import { resourceSuffix, runCleanup } from './support.js';

describe('broker adapter support', () => {
  it('round-trips the broker message envelope without losing binary data', () => {
    const message = {
      id: 'message-1',
      payload: Uint8Array.from([0, 1, 2, 255]),
      publishedAtNanoseconds: 123_456_789n,
    };

    expect(decodeMessage(encodeMessage(message), 'consumer-1')).toEqual({
      ...message,
      payload: Buffer.from(message.payload),
      consumerId: 'consumer-1',
    });
  });

  it('creates broker-safe resource suffixes', () => {
    expect(resourceSuffix('ABC-123_def')).toBe('abc123def');
    expect(() => resourceSuffix('---')).toThrow();
  });

  it('attempts every cleanup task and reports individual failures', async () => {
    const completed: string[] = [];
    const report = await runCleanup([
      {
        resource: 'first',
        cleanup: () => {
          completed.push('first');
        },
      },
      {
        resource: 'broken',
        cleanup: () => {
          throw new Error('cleanup failed');
        },
      },
      {
        resource: 'last',
        cleanup: () => {
          completed.push('last');
        },
      },
    ]);

    expect(completed).toEqual(['first', 'last']);
    expect(report).toEqual({
      attemptedResources: 3,
      removedResources: 2,
      failures: [{ resource: 'broken', message: 'cleanup failed' }],
    });
  });
});
