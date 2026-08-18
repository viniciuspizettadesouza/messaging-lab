import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
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
  PRAGMA user_version = 1;
`;

export function openDatabase(databaseUrl: string): DatabaseSync {
  if (databaseUrl !== ':memory:') {
    mkdirSync(dirname(resolve(databaseUrl)), { recursive: true });
  }

  const database = new DatabaseSync(databaseUrl);
  database.exec('PRAGMA foreign_keys = ON;');

  if (databaseUrl !== ':memory:') {
    database.exec('PRAGMA journal_mode = WAL;');
  }

  database.exec(SCHEMA);
  return database;
}
