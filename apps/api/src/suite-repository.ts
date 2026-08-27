import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  suiteConfigurationSchema,
  suiteErrorSchema,
  environmentSnapshotSchema,
  suiteNameSchema,
  suiteRunSchema,
  suiteSchema,
  suiteStatusSchema,
  type RunStatus,
  type Suite,
  type SuiteCombination,
  type SuiteConfiguration,
  type SuiteError,
  type EnvironmentSnapshot,
  type SuiteStatus,
  type BrokerId,
  type ScenarioId,
  COMPARISON_TRACK_IDS,
  comparisonTrackFor,
} from '@messaging-lab/shared';

import { RunRepository } from './run-repository.js';
import { summarizeSuiteCombinations } from './benchmark/suite-statistics.js';

export interface SuiteExecutionItem {
  readonly position: number;
  readonly combinationIndex: number;
  readonly repetition: number;
  readonly combination: SuiteCombination;
}

export interface ListSuitesOptions {
  readonly status?: SuiteStatus;
  readonly broker?: BrokerId;
  readonly scenario?: ScenarioId;
  readonly suite?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface ListSuitesResult {
  readonly suites: Suite[];
  readonly total: number;
}

interface SuiteRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly configuration_json: string;
  readonly status: string;
  readonly created_at: string;
  readonly started_at: string | null;
  readonly finished_at: string | null;
  readonly stop_reason: string | null;
}

interface SuiteRunRow {
  readonly position: number;
  readonly combination_index: number;
  readonly repetition: number;
  readonly broker: string;
  readonly scenario: string;
  readonly run_id: string | null;
}

interface SuiteErrorRow {
  readonly code: string;
  readonly message: string;
  readonly occurred_at: string;
  readonly details_json: string | null;
}

interface EnvironmentRow {
  readonly snapshot_json: string;
}

const TERMINAL_SUITE_STATUSES = new Set<SuiteStatus>([
  'completed',
  'failed',
  'cancelled',
  'stopped',
]);
const TERMINAL_RUN_STATUSES = new Set<RunStatus>([
  'completed',
  'failed',
  'timed-out',
  'cancelled',
]);

export class SuiteRepository {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly runs: RunRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {}

  public create(
    name: string,
    configuration: SuiteConfiguration,
    executionOrder: readonly SuiteExecutionItem[],
    environment: EnvironmentSnapshot,
    description: string | null = null,
  ): Suite {
    const parsedConfiguration = suiteConfigurationSchema.parse(configuration);
    const parsedName = suiteNameSchema.parse(name);
    const parsedEnvironment = environmentSnapshotSchema.parse(environment);
    validateExecutionOrder(parsedConfiguration, executionOrder);

    const id = this.createId();
    const createdAt = this.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      this.database
        .prepare(
          `INSERT INTO suites (
            id, name, description, configuration_json, status, created_at
          ) VALUES (?, ?, ?, ?, 'pending', ?)`,
        )
        .run(
          id,
          parsedName,
          description,
          JSON.stringify(parsedConfiguration),
          createdAt,
        );
      const insertItem = this.database.prepare(
        `INSERT INTO suite_runs (
          suite_id, position, combination_index, repetition, broker, scenario
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const item of executionOrder) {
        insertItem.run(
          id,
          item.position,
          item.combinationIndex,
          item.repetition,
          item.combination.broker,
          item.combination.scenario,
        );
      }
      this.database
        .prepare(
          `INSERT INTO suite_environment_snapshots (suite_id, snapshot_json)
           VALUES (?, ?)`,
        )
        .run(id, JSON.stringify(parsedEnvironment));
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }

    return this.requireById(id);
  }

  public getById(id: string): Suite | null {
    const row = this.database
      .prepare('SELECT * FROM suites WHERE id = ?')
      .get(id) as SuiteRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  public requireById(id: string): Suite {
    const suite = this.getById(id);
    if (!suite) throw new Error(`Suite ${id} does not exist.`);
    return suite;
  }

  public list(options: ListSuitesOptions): ListSuitesResult {
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    if (options.status) {
      conditions.push('status = ?');
      values.push(options.status);
    }
    if (options.broker) {
      conditions.push(
        'id IN (SELECT suite_id FROM suite_runs WHERE broker = ?)',
      );
      values.push(options.broker);
    }
    if (options.scenario) {
      conditions.push(
        'id IN (SELECT suite_id FROM suite_runs WHERE scenario = ?)',
      );
      values.push(options.scenario);
    }
    if (options.suite) {
      conditions.push('id = ?');
      values.push(options.suite);
    }
    if (options.dateFrom) {
      conditions.push('created_at >= ?');
      values.push(`${options.dateFrom}T00:00:00.000Z`);
    }
    if (options.dateTo) {
      conditions.push('created_at <= ?');
      values.push(`${options.dateTo}T23:59:59.999Z`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.database
      .prepare(
        `SELECT * FROM suites ${where}
         ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(...values, options.limit, options.offset) as unknown as SuiteRow[];
    const count = this.database
      .prepare(`SELECT COUNT(*) AS total FROM suites ${where}`)
      .get(...values) as { total: number };
    return { suites: rows.map((row) => this.hydrate(row)), total: count.total };
  }

  public attachRun(suiteId: string, position: number, runId: string): Suite {
    const suite = this.requireById(suiteId);
    const item = suite.runs[position];
    const run = this.runs.requireById(runId);
    if (
      !item ||
      item.position !== position ||
      run.configuration.broker !== item.combination.broker ||
      run.configuration.scenario !== item.combination.scenario
    ) {
      throw new Error(
        `Run ${runId} does not match suite ${suiteId} position ${position}.`,
      );
    }
    const result = this.database
      .prepare(
        `UPDATE suite_runs SET run_id = ?
         WHERE suite_id = ? AND position = ? AND run_id IS NULL`,
      )
      .run(runId, suiteId, position);
    if (result.changes === 0) {
      throw new Error(
        `Suite ${suiteId} has no unassigned run at position ${position}.`,
      );
    }
    return this.requireById(suiteId);
  }

  public updateStatus(
    id: string,
    nextStatus: SuiteStatus,
    stopReason: string | null = null,
  ): Suite {
    suiteStatusSchema.parse(nextStatus);
    const timestamp = this.now().toISOString();
    let result;
    if (nextStatus === 'running') {
      result = this.database
        .prepare(
          `UPDATE suites SET status = ?, started_at = COALESCE(started_at, ?)
           WHERE id = ?`,
        )
        .run(nextStatus, timestamp, id);
    } else if (TERMINAL_SUITE_STATUSES.has(nextStatus)) {
      result = this.database
        .prepare(
          `UPDATE suites SET status = ?, finished_at = ?, stop_reason = ?
           WHERE id = ?`,
        )
        .run(nextStatus, timestamp, stopReason, id);
    } else {
      result = this.database
        .prepare('UPDATE suites SET status = ? WHERE id = ?')
        .run(nextStatus, id);
    }
    if (result.changes === 0) throw new Error(`Suite ${id} does not exist.`);
    return this.requireById(id);
  }

  public addError(id: string, error: SuiteError): Suite {
    const parsed = suiteErrorSchema.parse(error);
    this.database
      .prepare(
        `INSERT INTO suite_errors (
          suite_id, code, message, occurred_at, details_json
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

  public recoverInterruptedSuites(): number {
    const interrupted = this.database
      .prepare("SELECT id FROM suites WHERE status IN ('pending', 'running')")
      .all() as unknown as Array<{ id: string }>;
    if (interrupted.length === 0) return 0;

    const occurredAt = this.now().toISOString();
    const reason =
      'The API restarted before the suite reached a terminal state.';
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const update = this.database.prepare(
        `UPDATE suites
         SET status = 'stopped', finished_at = ?, stop_reason = ? WHERE id = ?`,
      );
      const insertError = this.database.prepare(
        `INSERT INTO suite_errors (suite_id, code, message, occurred_at)
         VALUES (?, 'SUITE_INTERRUPTED', ?, ?)`,
      );
      for (const { id } of interrupted) {
        update.run(occurredAt, reason, id);
        insertError.run(id, reason, occurredAt);
      }
      this.database.exec('COMMIT;');
      return interrupted.length;
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  public delete(id: string): number | null {
    const suite = this.getById(id);
    if (!suite) return null;
    if (!TERMINAL_SUITE_STATUSES.has(suite.status)) {
      throw new Error('Only terminal suites can be deleted.');
    }
    const runIds = suite.runs.flatMap(({ run }) => (run ? [run.id] : []));
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      this.database.prepare('DELETE FROM suites WHERE id = ?').run(id);
      const deleteRun = this.database.prepare('DELETE FROM runs WHERE id = ?');
      for (const runId of runIds) deleteRun.run(runId);
      this.database.exec('COMMIT;');
      return runIds.length;
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  private hydrate(row: SuiteRow): Suite {
    const configuration = suiteConfigurationSchema.parse(
      JSON.parse(row.configuration_json),
    );
    const itemRows = this.database
      .prepare(
        `SELECT position, combination_index, repetition, broker, scenario, run_id
         FROM suite_runs WHERE suite_id = ? ORDER BY position`,
      )
      .all(row.id) as unknown as SuiteRunRow[];
    const errorRows = this.database
      .prepare(
        `SELECT code, message, occurred_at, details_json
         FROM suite_errors WHERE suite_id = ? ORDER BY id`,
      )
      .all(row.id) as unknown as SuiteErrorRow[];
    const environmentRow = this.database
      .prepare(
        'SELECT snapshot_json FROM suite_environment_snapshots WHERE suite_id = ?',
      )
      .get(row.id) as EnvironmentRow | undefined;
    const suiteRuns = itemRows.map((item) =>
      suiteRunSchema.parse({
        position: item.position,
        combinationIndex: item.combination_index,
        repetition: item.repetition,
        combination: { broker: item.broker, scenario: item.scenario },
        comparisonTrack: comparisonTrackFor(
          item.broker as BrokerId,
          item.scenario as ScenarioId,
        ),
        run: item.run_id ? this.runs.requireById(item.run_id) : null,
      }),
    );
    const counts: Record<RunStatus, number> = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      'timed-out': 0,
      cancelled: 0,
    };
    for (const item of suiteRuns) counts[item.run?.status ?? 'pending'] += 1;
    const activeItem = suiteRuns.find(
      (item) => item.run && !TERMINAL_RUN_STATUSES.has(item.run.status),
    );
    const completedRuns = suiteRuns.filter(
      (item) => item.run && TERMINAL_RUN_STATUSES.has(item.run.status),
    ).length;
    const comparisonTracks = COMPARISON_TRACK_IDS.filter((track) =>
      suiteRuns.some((item) => item.comparisonTrack === track),
    );
    const byTrack = comparisonTracks.map((comparisonTrack) => {
      const trackRuns = suiteRuns.filter(
        (item) => item.comparisonTrack === comparisonTrack,
      );
      const trackCount = (status: RunStatus) =>
        trackRuns.filter((item) => (item.run?.status ?? 'pending') === status)
          .length;
      return {
        comparisonTrack,
        totalRuns: trackRuns.length,
        pendingRuns: trackCount('pending'),
        runningRuns: trackCount('running'),
        completedRuns: trackCount('completed'),
        failedRuns: trackCount('failed'),
        timedOutRuns: trackCount('timed-out'),
        cancelledRuns: trackCount('cancelled'),
      };
    });

    return suiteSchema.parse({
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      configuration,
      comparisonTracks,
      progress: {
        completedRuns,
        totalRuns: suiteRuns.length,
        currentPosition: activeItem?.position ?? null,
        currentCombination: activeItem?.combination ?? null,
        currentRepetition: activeItem?.repetition ?? null,
        activeRunId: activeItem?.run?.id ?? null,
      },
      summary: {
        totalRuns: suiteRuns.length,
        pendingRuns: counts.pending,
        runningRuns: counts.running,
        completedRuns: counts.completed,
        failedRuns: counts.failed,
        timedOutRuns: counts['timed-out'],
        cancelledRuns: counts.cancelled,
        byTrack,
      },
      combinationSummaries: summarizeSuiteCombinations(
        configuration.combinations,
        suiteRuns,
      ),
      environment: environmentRow
        ? environmentSnapshotSchema.parse(
            JSON.parse(environmentRow.snapshot_json),
          )
        : null,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      stopReason: row.stop_reason,
      errors: errorRows.map((error) => ({
        code: error.code,
        message: error.message,
        occurredAt: error.occurred_at,
        ...(error.details_json
          ? {
              details: JSON.parse(error.details_json) as Record<
                string,
                unknown
              >,
            }
          : {}),
      })),
      runs: suiteRuns,
    });
  }
}

function validateExecutionOrder(
  configuration: SuiteConfiguration,
  executionOrder: readonly SuiteExecutionItem[],
): void {
  const expectedRuns =
    configuration.combinations.length * configuration.repetitions;
  const seen = new Set<string>();
  const valid =
    executionOrder.length === expectedRuns &&
    executionOrder.every((item, index) => {
      const configuredCombination =
        configuration.combinations[item.combinationIndex];
      const key = `${item.repetition}:${item.combinationIndex}`;
      if (
        item.position !== index ||
        item.repetition < 1 ||
        item.repetition > configuration.repetitions ||
        !configuredCombination ||
        configuredCombination.broker !== item.combination.broker ||
        configuredCombination.scenario !== item.combination.scenario ||
        seen.has(key)
      ) {
        return false;
      }
      seen.add(key);
      return true;
    });

  if (!valid || seen.size !== expectedRuns) {
    throw new Error('Suite execution order does not match its configuration.');
  }
}
