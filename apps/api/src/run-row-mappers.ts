import {
  runSchema,
  type BrokerId,
  type Run,
  type RunConfiguration,
  type RunStatus,
} from '@messaging-lab/shared';

export interface RunRow {
  id: string;
  name: string | null;
  description: string | null;
  broker: BrokerId;
  scenario: RunConfiguration['scenario'];
  message_count: number;
  payload_size_bytes: number;
  producer_concurrency: number;
  consumer_count: number;
  timeout_ms: number;
  status: RunStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface MetricsRow {
  elapsed_ms: number;
  throughput_messages_per_second: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  published_messages: number;
  received_messages: number;
  lost_messages: number;
  duplicate_messages: number;
  error_count: number;
}

export interface NoteRow {
  note: string;
}

export interface ErrorRow {
  code: string;
  message: string;
  occurred_at: string;
  details_json: string | null;
}

export function mapRunRows(
  row: RunRow,
  metricsRow: MetricsRow | undefined,
  noteRows: readonly NoteRow[],
  errorRows: readonly ErrorRow[],
): Run {
  return runSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    configuration: {
      broker: row.broker,
      scenario: row.scenario,
      messageCount: row.message_count,
      payloadSizeBytes: row.payload_size_bytes,
      producerConcurrency: row.producer_concurrency,
      consumerCount: row.consumer_count,
      timeoutMs: row.timeout_ms,
    },
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    metrics: metricsRow
      ? {
          elapsedMs: metricsRow.elapsed_ms,
          throughputMessagesPerSecond:
            metricsRow.throughput_messages_per_second,
          latency: {
            p50Ms: metricsRow.p50_ms,
            p95Ms: metricsRow.p95_ms,
            p99Ms: metricsRow.p99_ms,
          },
          publishedMessages: metricsRow.published_messages,
          receivedMessages: metricsRow.received_messages,
          lostMessages: metricsRow.lost_messages,
          duplicateMessages: metricsRow.duplicate_messages,
          errorCount: metricsRow.error_count,
        }
      : null,
    notes: noteRows.map(({ note }) => note),
    errors: errorRows.map((error) => ({
      code: error.code,
      message: error.message,
      occurredAt: error.occurred_at,
      ...(error.details_json
        ? { details: parseDetails(error.details_json) }
        : {}),
    })),
  });
}

function parseDetails(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Persisted run error details must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}
