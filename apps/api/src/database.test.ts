import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { BENCHMARK_DEFAULTS } from '@messaging-lab/shared';

import { openDatabase } from './database.js';
import { migrateDatabase, migrations } from './migrations.js';
import { RunRepository } from './run-repository.js';
import { SuiteRepository } from './suite-repository.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('openDatabase', () => {
  it('creates the schema and persists run history across connections', () => {
    const directory = mkdtempSync(join(tmpdir(), 'messaging-lab-api-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'runs.sqlite');
    const firstDatabase = openDatabase(path);
    const firstRepository = new RunRepository(
      firstDatabase,
      () => new Date('2026-08-18T12:00:00.000Z'),
      () => '11111111-1111-4111-8111-111111111111',
    );
    const created = firstRepository.create({
      broker: 'kafka',
      scenario: 'fan-out',
      ...BENCHMARK_DEFAULTS,
    });
    firstDatabase.close();

    const secondDatabase = openDatabase(path);
    const secondRepository = new RunRepository(secondDatabase);

    expect(secondRepository.getById(created.id)).toEqual(created);
    expect(secondDatabase.prepare('PRAGMA user_version').get()).toMatchObject({
      user_version: 3,
    });
    secondDatabase.close();
  });

  it('applies pending migrations once and keeps the schema current', () => {
    const database = openDatabase(':memory:');
    expect(database.prepare('PRAGMA user_version').get()).toEqual({
      user_version: 3,
    });
    expect(() => migrateDatabase(database)).not.toThrow();
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'runs'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('suites', 'suite_runs', 'suite_environment_snapshots')",
        )
        .get(),
    ).toEqual({ count: 3 });
    database.close();
  });

  it('upgrades a version-one database without losing existing runs', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(migrations[0]!.sql);
    database.exec('PRAGMA user_version = 1;');
    database
      .prepare(
        `INSERT INTO runs (
          id, broker, scenario, message_count, payload_size_bytes,
          producer_concurrency, consumer_count, timeout_ms, status, created_at
        ) VALUES (?, 'redis', 'fan-out', 1, 1, 1, 1, 1000, 'completed', ?)`,
      )
      .run('11111111-1111-4111-8111-111111111111', '2026-08-19T12:00:00.000Z');

    migrateDatabase(database);

    expect(database.prepare('PRAGMA user_version').get()).toEqual({
      user_version: 3,
    });
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM runs').get(),
    ).toEqual({
      count: 1,
    });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'suites'",
        )
        .get(),
    ).toEqual({ count: 1 });
    database.close();
  });

  it('keeps version-two suites readable without fabricating provenance', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(migrations[0]!.sql);
    database.exec(migrations[1]!.sql);
    database.exec('PRAGMA user_version = 2;');
    const configuration = {
      workload: BENCHMARK_DEFAULTS,
      combinations: [{ broker: 'kafka', scenario: 'fan-out' }],
      repetitions: 1,
      orderStrategy: 'fixed',
      cooldownMs: 0,
    };
    database
      .prepare(
        `INSERT INTO suites (id, name, configuration_json, status, created_at)
         VALUES (?, 'Legacy suite', ?, 'completed', ?)`,
      )
      .run(
        '22222222-2222-4222-8222-222222222222',
        JSON.stringify(configuration),
        '2026-08-19T12:00:00.000Z',
      );
    database
      .prepare(
        `INSERT INTO suite_runs (
          suite_id, position, combination_index, repetition, broker, scenario
        ) VALUES (?, 0, 0, 1, 'kafka', 'fan-out')`,
      )
      .run('22222222-2222-4222-8222-222222222222');

    migrateDatabase(database);
    const suites = new SuiteRepository(database, new RunRepository(database));

    expect(
      suites.requireById('22222222-2222-4222-8222-222222222222').environment,
    ).toBeNull();
    database.close();
  });

  it('refuses a database created by a newer application version', () => {
    const directory = mkdtempSync(join(tmpdir(), 'messaging-lab-api-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'future.sqlite');
    const futureDatabase = new DatabaseSync(path);
    futureDatabase.exec('PRAGMA user_version = 999;');
    futureDatabase.close();

    expect(() => openDatabase(path)).toThrow('newer than supported version 3');
  });
});
