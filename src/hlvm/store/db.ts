/**
 * SQLite Connection Singleton
 *
 * Lazy initialization — no startup cost when new endpoints aren't hit.
 * Uses WAL mode for concurrent reads and busy timeout for write contention.
 */

import { Database } from "@db/sqlite";
import { getConversationsDbPath } from "../../common/paths.ts";
import { getPlatform } from "../../platform/platform.ts";
import {
  CONVERSATIONS_SCHEMA_USER_VERSION,
  getSchemaUserVersion,
  initSchema,
} from "./schema.ts";

let _db: Database | null = null;

function configureDb(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
}

function conversationsDbExists(dbPath: string): boolean {
  try {
    return getPlatform().fs.statSync(dbPath).isFile;
  } catch {
    return false;
  }
}

function openDb(dbPath: string): Database {
  const db = new Database(dbPath);
  configureDb(db);
  return db;
}

function resetConversationDbFiles(dbPath: string): void {
  const fs = getPlatform().fs;
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      fs.removeSync(path);
    } catch {
      continue;
    }
  }
}

function requiresConversationDbReset(dbPath: string): boolean {
  if (!conversationsDbExists(dbPath)) {
    return false;
  }

  let db: Database | null = null;
  try {
    db = openDb(dbPath);
    return getSchemaUserVersion(db) !== CONVERSATIONS_SCHEMA_USER_VERSION;
  } catch {
    return true;
  } finally {
    try {
      db?.close();
    } catch {
      // best-effort probe cleanup
    }
  }
}

export function getDb(): Database {
  if (!_db) {
    const dbPath = getConversationsDbPath();
    const dir = getPlatform().path.dirname(dbPath);
    getPlatform().fs.mkdirSync(dir, { recursive: true });

    if (requiresConversationDbReset(dbPath)) {
      resetConversationDbFiles(dbPath);
    }

    _db = openDb(dbPath);
    initSchema(_db);
  }
  return _db;
}

export function _setDbForTesting(db: Database): void {
  _db = db;
}

export function _clearDbForTesting(expected?: Database): void {
  if (!expected || _db === expected) {
    _db = null;
  }
}

export function _resetDbForTesting(): void {
  if (_db) {
    try {
      _db.close();
    } catch { /* best-effort */ }
  }
  _db = null;
}
