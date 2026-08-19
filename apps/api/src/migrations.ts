import type { DatabaseSync } from 'node:sqlite';

interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'initial run storage',
    sql: `
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        broker TEXT NOT NULL CHECK (broker IN ('redis', 'kafka', 'rabbitmq')),
        scenario TEXT NOT NULL CHECK (scenario IN ('fan-out', 'competing-consumers')),
        message_count INTEGER NOT NULL CHECK (message_count > 0),
        payload_size_bytes INTEGER NOT NULL CHECK (payload_size_bytes > 0),
        producer_concurrency INTEGER NOT NULL CHECK (producer_concurrency > 0),
        consumer_count INTEGER NOT NULL CHECK (consumer_count > 0),
        timeout_ms INTEGER NOT NULL CHECK (timeout_ms > 0),
        status TEXT NOT NULL CHECK (
          status IN ('pending', 'running', 'completed', 'failed', 'timed-out', 'cancelled')
        ),
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS runs_created_at_idx ON runs (created_at DESC);
      CREATE INDEX IF NOT EXISTS runs_broker_idx ON runs (broker);
      CREATE INDEX IF NOT EXISTS runs_status_idx ON runs (status);

      CREATE TABLE IF NOT EXISTS run_metrics (
        run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
        elapsed_ms REAL NOT NULL CHECK (elapsed_ms >= 0),
        throughput_messages_per_second REAL NOT NULL CHECK (throughput_messages_per_second >= 0),
        p50_ms REAL NOT NULL CHECK (p50_ms >= 0),
        p95_ms REAL NOT NULL CHECK (p95_ms >= 0),
        p99_ms REAL NOT NULL CHECK (p99_ms >= 0),
        published_messages INTEGER NOT NULL CHECK (published_messages >= 0),
        received_messages INTEGER NOT NULL CHECK (received_messages >= 0),
        lost_messages INTEGER NOT NULL CHECK (lost_messages >= 0),
        duplicate_messages INTEGER NOT NULL CHECK (duplicate_messages >= 0),
        error_count INTEGER NOT NULL CHECK (error_count >= 0)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS run_notes (
        id INTEGER PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        note TEXT NOT NULL CHECK (length(note) > 0)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS run_notes_run_id_idx ON run_notes (run_id, id);

      CREATE TABLE IF NOT EXISTS run_errors (
        id INTEGER PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        code TEXT NOT NULL CHECK (length(code) > 0),
        message TEXT NOT NULL CHECK (length(message) > 0),
        occurred_at TEXT NOT NULL,
        details_json TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS run_errors_run_id_idx ON run_errors (run_id, id);
    `,
  },
  {
    version: 2,
    name: 'persistent benchmark suites',
    sql: `
      CREATE TABLE suites (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        configuration_json TEXT NOT NULL CHECK (json_valid(configuration_json)),
        status TEXT NOT NULL CHECK (
          status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'stopped')
        ),
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        stop_reason TEXT
      ) STRICT;
      CREATE INDEX suites_created_at_idx ON suites (created_at DESC);
      CREATE INDEX suites_status_idx ON suites (status);

      CREATE TABLE suite_runs (
        suite_id TEXT NOT NULL REFERENCES suites(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        combination_index INTEGER NOT NULL CHECK (combination_index >= 0),
        repetition INTEGER NOT NULL CHECK (repetition > 0),
        broker TEXT NOT NULL CHECK (broker IN ('redis', 'kafka', 'rabbitmq')),
        scenario TEXT NOT NULL CHECK (scenario IN ('fan-out', 'competing-consumers')),
        run_id TEXT UNIQUE REFERENCES runs(id) ON DELETE SET NULL,
        PRIMARY KEY (suite_id, position)
      ) STRICT;
      CREATE INDEX suite_runs_run_id_idx ON suite_runs (run_id);

      CREATE TABLE suite_errors (
        id INTEGER PRIMARY KEY,
        suite_id TEXT NOT NULL REFERENCES suites(id) ON DELETE CASCADE,
        code TEXT NOT NULL CHECK (length(code) > 0),
        message TEXT NOT NULL CHECK (length(message) > 0),
        occurred_at TEXT NOT NULL,
        details_json TEXT
      ) STRICT;
      CREATE INDEX suite_errors_suite_id_idx ON suite_errors (suite_id, id);
    `,
  },
  {
    version: 3,
    name: 'suite environment snapshots',
    sql: `
      CREATE TABLE suite_environment_snapshots (
        suite_id TEXT PRIMARY KEY REFERENCES suites(id) ON DELETE CASCADE,
        snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
      ) STRICT;
    `,
  },
  {
    version: 4,
    name: 'named experiment history',
    sql: `
      ALTER TABLE runs ADD COLUMN name TEXT CHECK (
        name IS NULL OR length(name) BETWEEN 1 AND 120
      );
      ALTER TABLE runs ADD COLUMN description TEXT CHECK (
        description IS NULL OR length(description) <= 500
      );
      ALTER TABLE suites ADD COLUMN description TEXT CHECK (
        description IS NULL OR length(description) <= 500
      );
      CREATE INDEX runs_scenario_idx ON runs (scenario);
      CREATE INDEX runs_created_at_filter_idx ON runs (created_at);
      CREATE INDEX suite_runs_suite_id_run_id_idx ON suite_runs (suite_id, run_id);
    `,
  },
];

export function migrateDatabase(database: DatabaseSync): void {
  const currentVersion = readUserVersion(database);
  const latestVersion = migrations.at(-1)?.version ?? 0;
  if (currentVersion > latestVersion) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than supported version ${latestVersion}.`,
    );
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(migration.sql);
      database.exec(`PRAGMA user_version = ${migration.version};`);
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw new Error(
        `Failed to apply database migration ${migration.version} (${migration.name}).`,
        { cause: error },
      );
    }
  }
}

export function readUserVersion(database: DatabaseSync): number {
  const row = database.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  return row.user_version;
}
