import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { migrateDatabase } from './migrations.js';

export function openDatabase(databaseUrl: string): DatabaseSync {
  if (databaseUrl !== ':memory:') {
    mkdirSync(dirname(resolve(databaseUrl)), { recursive: true });
  }

  const database = new DatabaseSync(databaseUrl);
  try {
    database.exec('PRAGMA foreign_keys = ON;');

    if (databaseUrl !== ':memory:') {
      database.exec('PRAGMA journal_mode = WAL;');
    }

    migrateDatabase(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
