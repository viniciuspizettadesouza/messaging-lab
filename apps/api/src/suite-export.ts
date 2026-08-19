import type { Suite } from '@messaging-lab/shared';

const CSV_COLUMNS = [
  'suite_id',
  'suite_name',
  'suite_status',
  'position',
  'combination_index',
  'repetition',
  'broker',
  'scenario',
  'run_id',
  'run_status',
  'created_at',
  'started_at',
  'finished_at',
  'elapsed_ms',
  'throughput_messages_per_second',
  'latency_p50_ms',
  'latency_p95_ms',
  'latency_p99_ms',
  'published_messages',
  'received_messages',
  'lost_messages',
  'duplicate_messages',
  'redelivered_messages',
  'error_count',
  'errors',
] as const;

export function serializeSuiteCsv(suite: Suite): string {
  const rows = suite.runs.map((trial) => {
    const run = trial.run;
    const metrics = run?.metrics;
    return [
      suite.id,
      suite.name,
      suite.status,
      trial.position,
      trial.combinationIndex,
      trial.repetition,
      trial.combination.broker,
      trial.combination.scenario,
      run?.id ?? '',
      run?.status ?? 'pending',
      run?.createdAt ?? '',
      run?.startedAt ?? '',
      run?.finishedAt ?? '',
      metrics?.elapsedMs ?? '',
      metrics?.throughputMessagesPerSecond ?? '',
      metrics?.latency.p50Ms ?? '',
      metrics?.latency.p95Ms ?? '',
      metrics?.latency.p99Ms ?? '',
      metrics?.publishedMessages ?? '',
      metrics?.receivedMessages ?? '',
      metrics?.lostMessages ?? '',
      metrics?.duplicateMessages ?? '',
      0,
      metrics?.errorCount ?? run?.errors.length ?? 0,
      run?.errors
        .map(({ code, message }) => `${code}: ${message}`)
        .join(' | ') ?? '',
    ];
  });
  return [CSV_COLUMNS, ...rows]
    .map((row) => row.map(csvCell).join(','))
    .join('\n')
    .concat('\n');
}

function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
