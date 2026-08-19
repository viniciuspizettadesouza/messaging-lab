import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from './client.js';

afterEach(() => vi.unstubAllGlobals());

describe('ApiClient errors', () => {
  it('preserves server error code, details, status, and category', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: 'RUN_ALREADY_ACTIVE',
              message: 'Another run is active.',
              details: { activeRunId: 'run-1' },
            },
          },
          { status: 409 },
        ),
      ),
    );

    await expect(new ApiClient().getBrokers()).rejects.toMatchObject({
      name: 'ApiClientError',
      kind: 'conflict',
      code: 'RUN_ALREADY_ACTIVE',
      status: 409,
      details: { activeRunId: 'run-1' },
    });
  });

  it('distinguishes connectivity and response validation failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    await expect(new ApiClient().getBrokers()).rejects.toEqual(
      expect.objectContaining({
        kind: 'connectivity',
        code: 'NETWORK_ERROR',
      }),
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ brokers: [{}] })),
    );
    await expect(new ApiClient().getBrokers()).rejects.toMatchObject({
      kind: 'validation',
      code: 'INVALID_API_RESPONSE',
    });
  });
});
