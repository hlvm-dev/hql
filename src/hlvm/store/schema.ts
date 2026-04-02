/**
 * Schema Module
 *
 * DDL for the conversations database.
 * Uses CREATE TABLE IF NOT EXISTS for idempotent initialization.
 */

import type { Database } from "@db/sqlite";

export const CONVERSATIONS_SCHEMA_VERSION_1 = 1;
export const CONVERSATIONS_SCHEMA_USER_VERSION = 2;

const DDL = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    message_count INTEGER NOT NULL DEFAULT 0,
    session_version INTEGER NOT NULL DEFAULT 0,
    metadata TEXT
  );

  CREATE TABLE IF NOT EXISTS host_state (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    "order" INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL DEFAULT '',
    display_content TEXT,
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
  db.exec(DDL);
  db.exec(`PRAGMA user_version = ${CONVERSATIONS_SCHEMA_USER_VERSION}`);
}

function columnExists(
  db: Database,
  tableName: string,
  columnName: string,
): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all<{
    name: string;
  }>();
  return columns.some((column) => column.name === columnName);
}

function tableExists(db: Database, tableName: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get<{ name: string }>(tableName);
  return row?.name === tableName;
}

export function migrateSchema(db: Database, fromVersion: number): void {
  if (fromVersion <= CONVERSATIONS_SCHEMA_VERSION_1) {
    if (
      tableExists(db, "messages") &&
      !columnExists(db, "messages", "display_content")
    ) {
      db.exec("ALTER TABLE messages ADD COLUMN display_content TEXT");
    }
    initSchema(db);
    return;
  }

  initSchema(db);
}

export function getSchemaUserVersion(db: Database): number {
  const row = db.prepare("PRAGMA user_version").value<[number]>();
  return row?.[0] ?? 0;
}
