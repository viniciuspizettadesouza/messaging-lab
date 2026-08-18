import {
  brokersResponseSchema,
  cancelRunResponseSchema,
  runEventSchema,
  runResponseSchema,
  runsResponseSchema,
  startRunRequestSchema,
  type BrokerInfo,
  type Run,
  type RunEvent,
  type StartRunRequest,
} from '@messaging-lab/shared';

export interface RunEventHandlers {
  readonly onEvent: (event: RunEvent) => void;
  readonly onDisconnect: () => void;
}

export interface DashboardApi {
  getBrokers(): Promise<BrokerInfo[]>;
  getRuns(): Promise<Run[]>;
  getRun(runId: string): Promise<Run>;
  startRun(request: StartRunRequest): Promise<Run>;
  cancelRun(runId: string): Promise<void>;
  subscribe(runId: string, handlers: RunEventHandlers): () => void;
}

export class ApiClient implements DashboardApi {
  public constructor(private readonly baseUrl = '') {}

  public async getBrokers(): Promise<BrokerInfo[]> {
    const response = await requestJson(`${this.baseUrl}/api/brokers`);
    return brokersResponseSchema.parse(response).brokers;
  }

  public async getRuns(): Promise<Run[]> {
    const response = await requestJson(`${this.baseUrl}/api/runs?limit=100`);
    return runsResponseSchema.parse(response).runs;
  }

  public async getRun(runId: string): Promise<Run> {
    return runResponseSchema.parse(
      await requestJson(`${this.baseUrl}/api/runs/${runId}`),
    );
  }

  public async startRun(request: StartRunRequest): Promise<Run> {
    const body = startRunRequestSchema.parse(request);
    return runResponseSchema.parse(
      await requestJson(`${this.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  }

  public async cancelRun(runId: string): Promise<void> {
    cancelRunResponseSchema.parse(
      await requestJson(`${this.baseUrl}/api/runs/${runId}/cancel`, {
        method: 'POST',
      }),
    );
  }

  public subscribe(runId: string, handlers: RunEventHandlers): () => void {
    const source = new EventSource(`${this.baseUrl}/api/runs/${runId}/events`);
    const eventTypes = ['status', 'progress', 'metrics', 'error'] as const;

    for (const type of eventTypes) {
      source.addEventListener(type, (message) => {
        if (!(message instanceof MessageEvent)) return;
        const result = runEventSchema.safeParse(
          JSON.parse(String(message.data)),
        );
        if (result.success) handlers.onEvent(result.data);
      });
    }
    source.onerror = () => handlers.onDisconnect();
    return () => source.close();
  }
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      extractErrorMessage(body) ?? `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return body;
}

function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('error' in body)) return null;
  const error = body.error;
  if (!error || typeof error !== 'object' || !('message' in error)) return null;
  return typeof error.message === 'string' ? error.message : null;
}
