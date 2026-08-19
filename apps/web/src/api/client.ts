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

import {
  ApiClientError,
  classifyServerError,
  responseValidationError,
} from './errors.js';

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
    return parseResponse(brokersResponseSchema, response).brokers;
  }

  public async getRuns(): Promise<Run[]> {
    const response = await requestJson(`${this.baseUrl}/api/runs?limit=100`);
    return parseResponse(runsResponseSchema, response).runs;
  }

  public async getRun(runId: string): Promise<Run> {
    return parseResponse(
      runResponseSchema,
      await requestJson(`${this.baseUrl}/api/runs/${runId}`),
    );
  }

  public async startRun(request: StartRunRequest): Promise<Run> {
    const body = startRunRequestSchema.parse(request);
    return parseResponse(
      runResponseSchema,
      await requestJson(`${this.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  }

  public async cancelRun(runId: string): Promise<void> {
    parseResponse(
      cancelRunResponseSchema,
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
        try {
          const result = runEventSchema.parse(JSON.parse(String(message.data)));
          handlers.onEvent(result);
        } catch {
          handlers.onDisconnect();
        }
      });
    }
    source.onerror = () => handlers.onDisconnect();
    return () => source.close();
  }
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new ApiClientError(
      'connectivity',
      'NETWORK_ERROR',
      'Could not connect to the Messaging Lab API.',
      null,
      undefined,
      { cause: error },
    );
  }

  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch (error) {
    throw responseValidationError(error);
  }

  if (!response.ok) {
    const serverError = extractServerError(body);
    const code = serverError?.code ?? `HTTP_${response.status}`;
    throw new ApiClientError(
      classifyServerError(response.status, code),
      code,
      serverError?.message ?? `Request failed (${response.status}).`,
      response.status,
      serverError?.details,
    );
  }
  return body;
}

function extractServerError(body: unknown): {
  code: string;
  message: string;
  details?: Record<string, unknown>;
} | null {
  if (!body || typeof body !== 'object' || !('error' in body)) return null;
  const error = body.error;
  if (
    !error ||
    typeof error !== 'object' ||
    !('code' in error) ||
    typeof error.code !== 'string' ||
    !('message' in error) ||
    typeof error.message !== 'string'
  ) {
    return null;
  }
  const details =
    'details' in error &&
    error.details !== null &&
    typeof error.details === 'object' &&
    !Array.isArray(error.details)
      ? (error.details as Record<string, unknown>)
      : undefined;
  return { code: error.code, message: error.message, details };
}

function parseResponse<T>(
  schema: { parse(value: unknown): T },
  value: unknown,
): T {
  try {
    return schema.parse(value);
  } catch (error) {
    throw responseValidationError(error);
  }
}
