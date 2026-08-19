import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

import {
  benchmarkMetricsSchema,
  runErrorSchema,
  runStatusSchema,
  type BenchmarkMetrics,
  type BrokerId,
  type Run,
  type RunConfiguration,
  type RunError,
  type RunStatus,
} from '@messaging-lab/shared';
import {
  mapRunRows,
  type ErrorRow,
  type MetricsRow,
  type NoteRow,
  type RunRow,
} from './run-row-mappers.js';

export interface ListRunsOptions {
  readonly broker?: BrokerId;
  readonly status?: RunStatus;
  readonly limit: number;
  readonly offset: number;
}

export interface ListRunsResult {
  readonly runs: Run[];
  readonly total: number;
}

const TERMINAL_STATUSES = new Set<RunStatus>([
  'completed',
  'failed',
  'timed-out',
  'cancelled',
]);

export class RunRepository {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {}

  public create(configuration: RunConfiguration): Run {
    const id = this.createId();
    const createdAt = this.now().toISOString();

    this.database
      .prepare(
        `INSERT INTO runs (
          id, broker, scenario, message_count, payload_size_bytes,
          producer_concurrency, consumer_count, timeout_ms, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        id,
        configuration.broker,
        configuration.scenario,
        configuration.messageCount,
        configuration.payloadSizeBytes,
        configuration.producerConcurrency,
        configuration.consumerCount,
        configuration.timeoutMs,
        createdAt,
      );

    return this.requireById(id);
  }

  public getById(id: string): Run | null {
    const row = this.database
      .prepare('SELECT * FROM runs WHERE id = ?')
      .get(id) as RunRow | undefined;

    return row ? this.hydrateRun(row) : null;
  }

  public requireById(id: string): Run {
    const run = this.getById(id);

    if (!run) {
      throw new Error(`Run ${id} does not exist.`);
    }

    return run;
  }

  public list(options: ListRunsOptions): ListRunsResult {
    const conditions: string[] = [];
    const values: SQLInputValue[] = [];

    if (options.broker) {
      conditions.push('broker = ?');
      values.push(options.broker);
    }

    if (options.status) {
      conditions.push('status = ?');
      values.push(options.status);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.database
      .prepare(
        `SELECT * FROM runs ${whereClause}
         ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(...values, options.limit, options.offset) as unknown as RunRow[];
    const countRow = this.database
      .prepare(`SELECT COUNT(*) AS total FROM runs ${whereClause}`)
      .get(...values) as { total: number };

    return {
      runs: rows.map((row) => this.hydrateRun(row)),
      total: countRow.total,
    };
  }

  public updateStatus(id: string, nextStatus: RunStatus): Run {
    runStatusSchema.parse(nextStatus);
    const timestamp = this.now().toISOString();
    let result;

    if (nextStatus === 'running') {
      result = this.database
        .prepare(
          `UPDATE runs
           SET status = ?, started_at = COALESCE(started_at, ?)
           WHERE id = ?`,
        )
        .run(nextStatus, timestamp, id);
    } else if (TERMINAL_STATUSES.has(nextStatus)) {
      result = this.database
        .prepare('UPDATE runs SET status = ?, finished_at = ? WHERE id = ?')
        .run(nextStatus, timestamp, id);
    } else {
      result = this.database
        .prepare('UPDATE runs SET status = ? WHERE id = ?')
        .run(nextStatus, id);
    }

    if (result.changes === 0) {
      throw new Error(`Run ${id} does not exist.`);
    }

    return this.requireById(id);
  }

  public saveMetrics(id: string, metrics: BenchmarkMetrics): Run {
    const parsed = benchmarkMetricsSchema.parse(metrics);

    this.database
      .prepare(
        `INSERT INTO run_metrics (
          run_id, elapsed_ms, throughput_messages_per_second,
          p50_ms, p95_ms, p99_ms, published_messages, received_messages,
          lost_messages, duplicate_messages, error_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          elapsed_ms = excluded.elapsed_ms,
          throughput_messages_per_second = excluded.throughput_messages_per_second,
          p50_ms = excluded.p50_ms,
          p95_ms = excluded.p95_ms,
          p99_ms = excluded.p99_ms,
          published_messages = excluded.published_messages,
          received_messages = excluded.received_messages,
          lost_messages = excluded.lost_messages,
          duplicate_messages = excluded.duplicate_messages,
          error_count = excluded.error_count`,
      )
      .run(
        id,
        parsed.elapsedMs,
        parsed.throughputMessagesPerSecond,
        parsed.latency.p50Ms,
        parsed.latency.p95Ms,
        parsed.latency.p99Ms,
        parsed.publishedMessages,
        parsed.receivedMessages,
        parsed.lostMessages,
        parsed.duplicateMessages,
        parsed.errorCount,
      );

    return this.requireById(id);
  }

  public addNote(id: string, note: string): Run {
    if (note.length === 0) {
      throw new Error('Run notes must not be empty.');
    }

    this.database
      .prepare('INSERT INTO run_notes (run_id, note) VALUES (?, ?)')
      .run(id, note);
    return this.requireById(id);
  }

  public addError(id: string, error: RunError): Run {
    const parsed = runErrorSchema.parse(error);
    this.database
      .prepare(
        `INSERT INTO run_errors (
          run_id, code, message, occurred_at, details_json
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        parsed.code,
        parsed.message,
        parsed.occurredAt,
        parsed.details ? JSON.stringify(parsed.details) : null,
      );
    return this.requireById(id);
  }

  public recoverInterruptedRuns(): number {
    const interrupted = this.database
      .prepare("SELECT id FROM runs WHERE status IN ('pending', 'running')")
      .all() as unknown as Array<{ id: string }>;

    if (interrupted.length === 0) {
      return 0;
    }

    const occurredAt = this.now().toISOString();

    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const update = this.database.prepare(
        `UPDATE runs SET status = 'failed', finished_at = ? WHERE id = ?`,
      );
      const insertError = this.database.prepare(
        `INSERT INTO run_errors (run_id, code, message, occurred_at)
         VALUES (?, 'RUN_INTERRUPTED', 'The API stopped before the run reached a terminal state.', ?)`,
      );

      for (const { id } of interrupted) {
        update.run(occurredAt, id);
        insertError.run(id, occurredAt);
      }

      this.database.exec('COMMIT;');
      return interrupted.length;
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  private hydrateRun(row: RunRow): Run {
    const metricsRow = this.database
      .prepare('SELECT * FROM run_metrics WHERE run_id = ?')
      .get(row.id) as MetricsRow | undefined;
    const noteRows = this.database
      .prepare('SELECT note FROM run_notes WHERE run_id = ? ORDER BY id')
      .all(row.id) as unknown as NoteRow[];
    const errorRows = this.database
      .prepare(
        `SELECT code, message, occurred_at, details_json
         FROM run_errors WHERE run_id = ? ORDER BY id`,
      )
      .all(row.id) as unknown as ErrorRow[];

    return mapRunRows(row, metricsRow, noteRows, errorRows);
  }
}
