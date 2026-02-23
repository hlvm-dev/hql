/**
 * Memory Search - SQLite FTS5 full-text search with temporal decay
 *
 * Follows store/db.ts pattern: lazy singleton, WAL mode, @db/sqlite.
 */

import { Database } from "@db/sqlite";
import { getMemoryIndexPath, ensureMemoryDirsSync } from "../../common/paths.ts";

// ============================================================
// Schema
// ============================================================

const DDL = `
  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY,
    file TEXT NOT NULL,
    line_start INTEGER NOT NULL,
    line_end INTEGER NOT NULL,
    text TEXT NOT NULL,
    date TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    text,
    content=chunks,
    content_rowid=id
  );

  CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file);

  CREATE TABLE IF NOT EXISTS meta (
    file TEXT PRIMARY KEY,
    mtime INTEGER NOT NULL,
    hash TEXT NOT NULL
  );
`;

// ============================================================
// Singleton
// ============================================================

let _db: Database | null = null;

export function getMemoryDb(): Database {
  if (!_db) {
    const dbPath = getMemoryIndexPath();
    // Use ensureMemoryDirsSync to respect 0o700 permissions (not raw mkdirSync)
    ensureMemoryDirsSync();

    _db = new Database(dbPath);
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA busy_timeout = 5000");
    _db.exec(DDL);
  }
  return _db;
}

export function closeMemoryDb(): void {
  _db?.close();
  _db = null;
}

// ============================================================
// Temporal Decay
// ============================================================

const HALF_LIFE_DAYS = 30;
const LAMBDA = Math.LN2 / HALF_LIFE_DAYS;

function decayScore(bm25Score: number, ageDays: number): number {
  return bm25Score * Math.exp(-LAMBDA * ageDays);
}

/** Convert "YYYY-MM-DD" to milliseconds (avoids Date object allocation per row) */
function dateStringToMs(dateStr: string): number {
  const [y, m, d] = dateStr.split("-");
  const ms = Date.UTC(+y, +m - 1, +d);
  return Number.isNaN(ms) ? Date.now() : ms;
}

// ============================================================
// Search
// ============================================================

export interface SearchResult {
  text: string;
  file: string;
  date: string;
  score: number;
}

/**
 * Search memory using FTS5 with temporal decay scoring.
 *
 * MEMORY.md entries get decay factor = 1.0 (always relevant).
 * Journal entries decay with half-life of 30 days.
 */
export function searchMemory(
  query: string,
  limit = 5,
): SearchResult[] {
  const db = getMemoryDb();
  const needle = query.trim();
  if (!needle) return [];

  // Escape FTS5 special characters and operators.
  // FTS5 treats AND/OR/NOT/NEAR as boolean operators and parens/colons/braces/pipes as syntax.
  // Quote each word to force literal matching: "word1" "word2" ...
  const words = needle
    .replace(/['"*():^{}|]/g, " ")     // strip ALL FTS5 syntax chars
    .split(/\s+/)
    .filter((w) => w && w.length <= 100 && !/^(AND|OR|NOT|NEAR)$/i.test(w));
  if (words.length === 0) return [];
  const escaped = words.map((w) => `"${w}"`).join(" ");

  const nowMs = Date.now();
  const msPerDay = 86_400_000;

  const ftsQuery = db.prepare(`
    SELECT c.text, c.file, c.date,
           rank AS bm25_score
    FROM chunks_fts
    JOIN chunks c ON c.id = chunks_fts.rowid
    WHERE chunks_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `);

  try {
    // AND-first query (current default: all words must match)
    let rows = ftsQuery.all(escaped, limit * 3) as Array<{
      text: string;
      file: string;
      date: string;
      bm25_score: number;
    }>;

    // P4: OR fallback — if AND yields nothing and there are multiple words, retry with OR
    if (rows.length === 0 && words.length > 1) {
      const orEscaped = words.map((w) => `"${w}"`).join(" OR ");
      rows = ftsQuery.all(orEscaped, limit * 3) as Array<{
        text: string;
        file: string;
        date: string;
        bm25_score: number;
      }>;
    }

    const results: SearchResult[] = rows.map((row) => {
      // Use the stable `date` field for aging (not created_at which resets on reindex).
      // date is "YYYY-MM-DD" for journals, or today's date for MEMORY.md.
      const dateMs = dateStringToMs(row.date);
      const ageDays = (nowMs - dateMs) / msPerDay;
      // MEMORY.md entries: no decay (always relevant)
      const isMemoryMd = row.file.endsWith("MEMORY.md");
      const score = isMemoryMd
        ? Math.abs(row.bm25_score)
        : decayScore(Math.abs(row.bm25_score), Math.max(0, ageDays));
      return {
        text: row.text,
        file: row.file,
        date: row.date,
        score,
      };
    });

    // P5: File-level deduplication — keep only the best-scoring chunk per file
    const bestByFile = new Map<string, SearchResult>();
    for (const r of results) {
      const existing = bestByFile.get(r.file);
      if (!existing || r.score > existing.score) bestByFile.set(r.file, r);
    }
    const deduplicated = [...bestByFile.values()];
    deduplicated.sort((a, b) => b.score - a.score);
    return deduplicated.slice(0, limit);
  } catch {
    // FTS5 query failed (e.g., empty index) — return empty
    return [];
  }
}

/**
 * Insert a chunk into the FTS5 index.
 * Used by the indexer module.
 */
export function insertChunk(
  file: string,
  lineStart: number,
  lineEnd: number,
  text: string,
  date: string,
): void {
  const db = getMemoryDb();
  const stmt = db.prepare(
    "INSERT INTO chunks (file, line_start, line_end, text, date) VALUES (?, ?, ?, ?, ?)",
  );
  stmt.run(file, lineStart, lineEnd, text, date);

  // Sync FTS5 content table
  const lastId = db.prepare("SELECT last_insert_rowid()").value<[number]>();
  if (lastId) {
    db.prepare(
      "INSERT INTO chunks_fts (rowid, text) VALUES (?, ?)",
    ).run(lastId[0], text);
  }
}

/**
 * Remove all chunks for a file (before re-indexing).
 */
export function removeChunksForFile(file: string): void {
  const db = getMemoryDb();

  // Get rowids to remove from FTS
  const rows = db.prepare(
    "SELECT id, text FROM chunks WHERE file = ?",
  ).all(file) as Array<{ id: number; text: string }>;

  for (const row of rows) {
    db.prepare(
      "INSERT INTO chunks_fts (chunks_fts, rowid, text) VALUES ('delete', ?, ?)",
    ).run(row.id, row.text);
  }

  db.prepare("DELETE FROM chunks WHERE file = ?").run(file);
}

/**
 * Get file metadata for change detection.
 */
export function getFileMeta(
  file: string,
): { mtime: number; hash: string } | null {
  const db = getMemoryDb();
  const row = db.prepare(
    "SELECT mtime, hash FROM meta WHERE file = ?",
  ).value<[number, string]>(file);
  if (!row) return null;
  return { mtime: row[0], hash: row[1] };
}

/**
 * Update file metadata after indexing.
 */
export function setFileMeta(
  file: string,
  mtime: number,
  hash: string,
): void {
  const db = getMemoryDb();
  db.prepare(
    "INSERT OR REPLACE INTO meta (file, mtime, hash) VALUES (?, ?, ?)",
  ).run(file, mtime, hash);
}
