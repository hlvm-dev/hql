/**
 * Memory DB - Canonical truth store for memory facts/entities/relationships.
 */

import { Database } from "@db/sqlite";
import { ensureMemoryDirsSync, getMemoryDbPath } from "../../common/paths.ts";

const DDL = `
  CREATE TABLE IF NOT EXISTS facts (
    id INTEGER PRIMARY KEY,
    content TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'General',
    source TEXT NOT NULL DEFAULT 'memory',
    embedding BLOB,
    embedding_model TEXT,
    valid_from TEXT NOT NULL,
    valid_until TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    accessed_at INTEGER,
    access_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
    content,
    content=facts,
    content_rowid=id
  );

  CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    embedding BLOB,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS relationships (
    id INTEGER PRIMARY KEY,
    from_entity INTEGER NOT NULL,
    to_entity INTEGER NOT NULL,
    relation TEXT NOT NULL,
    fact_id INTEGER,
    valid_from TEXT NOT NULL,
    valid_until TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY(from_entity) REFERENCES entities(id),
    FOREIGN KEY(to_entity) REFERENCES entities(id),
    FOREIGN KEY(fact_id) REFERENCES facts(id)
  );

  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_facts_valid_until ON facts(valid_until);
  CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(category);
  CREATE INDEX IF NOT EXISTS idx_facts_created_at ON facts(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_relationships_fact_id ON relationships(fact_id);
  CREATE INDEX IF NOT EXISTS idx_relationships_valid_until ON relationships(valid_until);
`;

let _db: Database | null = null;
const CURRENT_SCHEMA_VERSION = 3;

function getSchemaVersion(db: Database): number {
  const row = db.prepare(
    "SELECT MAX(version) AS version FROM schema_version",
  ).get<{ version: number | null }>();
  return row?.version ?? 0;
}

function migrateFactDb(db: Database): void {
  const current = getSchemaVersion(db);
  if (current >= CURRENT_SCHEMA_VERSION) return;

  db.exec("BEGIN");
  try {
    if (current < 3) {
      // Legacy journal entries now behave as durable memory facts.
      db.prepare(
        "UPDATE facts SET category = 'General' WHERE source = 'journal' AND category = 'Journal'",
      ).run();
      db.prepare(
        "UPDATE facts SET source = 'memory' WHERE source = 'journal'",
      ).run();
    }
    db.prepare(
      "INSERT OR REPLACE INTO schema_version(version) VALUES (?)",
    ).run(CURRENT_SCHEMA_VERSION);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getFactDb(): Database {
  if (!_db) {
    ensureMemoryDirsSync();
    _db = new Database(getMemoryDbPath());
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA busy_timeout = 5000");
    _db.exec(DDL);
    migrateFactDb(_db);
  }
  return _db;
}

export function closeFactDb(): void {
  _db?.close();
  _db = null;
}
