import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BENCHMARK_DEFAULTS } from '@messaging-lab/shared';

import { openDatabase } from './database.js';
import { RunRepository } from './run-repository.js';

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
      user_version: 1,
    });
    secondDatabase.close();
  });
});
