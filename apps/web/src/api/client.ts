import {
  brokersResponseSchema,
  cancelRunResponseSchema,
  cancelSuiteResponseSchema,
  createSuiteRequestSchema,
  deleteExperimentResponseSchema,
  runEventSchema,
  runResponseSchema,
  runsResponseSchema,
  startRunRequestSchema,
  suiteEventSchema,
  suiteResponseSchema,
  suitesResponseSchema,
  type BrokerInfo,
  type Run,
  type RunEvent,
  type StartRunRequest,
  type CreateSuiteRequest,
  type Suite,
  type SuiteEvent,
  type RunsResponse,
  type SuitesResponse,
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

export interface SuiteEventHandlers {
  readonly onEvent: (event: SuiteEvent) => void;
  readonly onDisconnect: () => void;
}

export interface HistoryQuery {
  readonly broker?: string;
  readonly scenario?: string;
  readonly status?: string;
  readonly suite?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface DashboardApi {
  getBrokers(): Promise<BrokerInfo[]>;
  getRuns(): Promise<Run[]>;
  getRunPage(query: HistoryQuery): Promise<RunsResponse>;
  getRun(runId: string): Promise<Run>;
  startRun(request: StartRunRequest): Promise<Run>;
  cancelRun(runId: string): Promise<void>;
  deleteRun(runId: string): Promise<void>;
  subscribe(runId: string, handlers: RunEventHandlers): () => void;
  getSuites(): Promise<Suite[]>;
  getSuitePage(query: HistoryQuery): Promise<SuitesResponse>;
  getSuite(suiteId: string): Promise<Suite>;
  startSuite(request: CreateSuiteRequest): Promise<Suite>;
  cancelSuite(suiteId: string): Promise<void>;
  deleteSuite(suiteId: string): Promise<void>;
  subscribeSuite(suiteId: string, handlers: SuiteEventHandlers): () => void;
}

export class ApiClient implements DashboardApi {
  public constructor(private readonly baseUrl = '') {}

  public async getBrokers(): Promise<BrokerInfo[]> {
    const response = await requestJson(`${this.baseUrl}/api/brokers`);
    return parseResponse(brokersResponseSchema, response).brokers;
  }

  public async getRuns(): Promise<Run[]> {
    return (await this.getRunPage({ limit: 100, offset: 0 })).runs;
  }

  public async getRunPage(query: HistoryQuery): Promise<RunsResponse> {
    const response = await requestJson(
      `${this.baseUrl}/api/runs?${historyParameters(query, true)}`,
    );
    return parseResponse(runsResponseSchema, response);
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

  public async deleteRun(runId: string): Promise<void> {
    parseResponse(
      deleteExperimentResponseSchema,
      await requestJson(`${this.baseUrl}/api/runs/${runId}`, {
        method: 'DELETE',
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

  public async getSuites(): Promise<Suite[]> {
    return (await this.getSuitePage({ limit: 100, offset: 0 })).suites;
  }

  public async getSuitePage(query: HistoryQuery): Promise<SuitesResponse> {
    const response = await requestJson(
      `${this.baseUrl}/api/suites?${historyParameters(query, true)}`,
    );
    return parseResponse(suitesResponseSchema, response);
  }

  public async getSuite(suiteId: string): Promise<Suite> {
    return parseResponse(
      suiteResponseSchema,
      await requestJson(`${this.baseUrl}/api/suites/${suiteId}`),
    );
  }

  public async startSuite(request: CreateSuiteRequest): Promise<Suite> {
    createSuiteRequestSchema.parse(request);
    return parseResponse(
      suiteResponseSchema,
      await requestJson(`${this.baseUrl}/api/suites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      }),
    );
  }

  public async cancelSuite(suiteId: string): Promise<void> {
    parseResponse(
      cancelSuiteResponseSchema,
      await requestJson(`${this.baseUrl}/api/suites/${suiteId}/cancel`, {
        method: 'POST',
      }),
    );
  }

  public async deleteSuite(suiteId: string): Promise<void> {
    parseResponse(
      deleteExperimentResponseSchema,
      await requestJson(`${this.baseUrl}/api/suites/${suiteId}`, {
        method: 'DELETE',
      }),
    );
  }

  public subscribeSuite(
    suiteId: string,
    handlers: SuiteEventHandlers,
  ): () => void {
    const source = new EventSource(
      `${this.baseUrl}/api/suites/${suiteId}/events`,
    );
    const eventTypes = [
      'status',
      'progress',
      'run-event',
      'summary',
      'error',
    ] as const;

    for (const type of eventTypes) {
      source.addEventListener(type, (message) => {
        if (!(message instanceof MessageEvent)) return;
        try {
          handlers.onEvent(
            suiteEventSchema.parse(JSON.parse(String(message.data))),
          );
        } catch {
          handlers.onDisconnect();
        }
      });
    }
    source.onerror = () => handlers.onDisconnect();
    return () => source.close();
  }
}

function historyParameters(query: HistoryQuery, includeSuite: boolean): string {
  const parameters = new URLSearchParams();
  for (const key of [
    'broker',
    'scenario',
    'status',
    'dateFrom',
    'dateTo',
  ] as const) {
    const value = query[key];
    if (value) parameters.set(key, value);
  }
  if (includeSuite && query.suite) parameters.set('suite', query.suite);
  parameters.set('limit', String(query.limit));
  parameters.set('offset', String(query.offset));
  return parameters.toString();
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
