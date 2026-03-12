/**
 * SQLite Connection Singleton
 *
 * Lazy initialization — no startup cost when new endpoints aren't hit.
 * Uses WAL mode for concurrent reads and busy timeout for write contention.
 */

import { Database } from "@db/sqlite";
import { getConversationsDbPath } from "../../common/paths.ts";
import { getPlatform } from "../../platform/platform.ts";
import { initSchema } from "./schema.ts";

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    const dbPath = getConversationsDbPath();
    const dir = getPlatform().path.dirname(dbPath);
    getPlatform().fs.mkdirSync(dir, { recursive: true });

    _db = new Database(dbPath);
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA foreign_keys = ON");
    _db.exec("PRAGMA busy_timeout = 5000");
    initSchema(_db);
  }
  return _db;
}

export function _setDbForTesting(db: Database): void {
  _db = db;
}

export function _resetDbForTesting(): void {
  if (_db) {
    try { _db.close(); } catch { /* best-effort */ }
  }
  _db = null;
}
