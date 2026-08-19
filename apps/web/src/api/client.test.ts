import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from './client.js';
import { createRun, createSuite } from '../test/fixtures.js';

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

describe('ApiClient suite boundaries', () => {
  it('validates suite creation requests and responses', async () => {
    const fetchMock = vi.fn(async () => Response.json(createSuite('pending')));
    vi.stubGlobal('fetch', fetchMock);

    const suite = await new ApiClient().startSuite({
      name: 'Client suite',
      combinations: [{ broker: 'redis', scenario: 'fan-out' }],
      repetitions: 1,
      orderStrategy: 'fixed',
      cooldownMs: 0,
    });

    expect(suite.status).toBe('pending');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/suites',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Client suite'),
      }),
    );
  });

  it('rejects malformed suite history responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ suites: [{}], total: 1, limit: 100, offset: 0 }),
      ),
    );

    await expect(new ApiClient().getSuites()).rejects.toMatchObject({
      kind: 'validation',
      code: 'INVALID_API_RESPONSE',
    });
  });
});

describe('ApiClient history', () => {
  it('sends filters and pagination and validates deletion', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          runs: [createRun('completed')],
          total: 11,
          limit: 10,
          offset: 10,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: createRun('completed').id,
          deleted: true,
          deletedRuns: 1,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient();

    const page = await client.getRunPage({
      broker: 'redis',
      scenario: 'fan-out',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      limit: 10,
      offset: 10,
    });
    await client.deleteRun(page.runs[0]!.id);

    expect(fetchMock.mock.calls[0]![0]).toContain(
      'broker=redis&scenario=fan-out&dateFrom=2026-08-01&dateTo=2026-08-31&limit=10&offset=10',
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/runs/'),
      { method: 'DELETE' },
    );
  });
});
