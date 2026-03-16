/**
 * Schema Module
 *
 * DDL for the conversations database.
 * Uses CREATE TABLE IF NOT EXISTS for idempotent initialization.
 */

import type { Database } from "@db/sqlite";

const CURRENT_SCHEMA_VERSION = 2;

// Per-version migrations. Keys are the version being migrated TO.
// Each migration assumes the previous version's schema is in place.
// For fresh installs, DDL (CREATE TABLE IF NOT EXISTS) handles everything.
const MIGRATIONS: Record<number, string[]> = {
  2: ["ALTER TABLE messages ADD COLUMN attachment_ids TEXT"],
};

const DDL = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    message_count INTEGER NOT NULL DEFAULT 0,
    session_version INTEGER NOT NULL DEFAULT 0,
    metadata TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    "order" INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL DEFAULT '',
    client_turn_id TEXT,
    request_id TEXT,
    sender_type TEXT NOT NULL DEFAULT 'user',
    sender_detail TEXT,
    attachment_ids TEXT,
    tool_calls TEXT,
    tool_name TEXT,
    tool_call_id TEXT,
    cancelled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(session_id, "order"),
    UNIQUE(session_id, client_turn_id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session_order
    ON messages(session_id, "order" DESC);
`;

export function initSchema(db: Database): void {
  const versionExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ).value<[string]>();

  if (!versionExists) {
    db.exec(DDL);
    db.prepare(
      "INSERT INTO schema_version (version) VALUES (?)"
    ).run(CURRENT_SCHEMA_VERSION);
    return;
  }

  const row = db.prepare(
    "SELECT MAX(version) FROM schema_version"
  ).value<[number]>();
  const currentVersion = row?.[0] ?? 0;

  if (currentVersion < CURRENT_SCHEMA_VERSION) {
    // Run incremental migrations from currentVersion+1 to CURRENT_SCHEMA_VERSION
    for (let v = currentVersion + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      const stmts = MIGRATIONS[v];
      if (stmts) {
        for (const sql of stmts) {
          db.exec(sql);
        }
      }
    }
    // Ensure all tables/indexes exist (idempotent DDL for fresh or partially migrated)
    db.exec(DDL);
    db.prepare(
      "INSERT INTO schema_version (version) VALUES (?)"
    ).run(CURRENT_SCHEMA_VERSION);
  }
}
