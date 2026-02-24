/**
 * Memory Indexer - Chunks files and inserts into FTS5 index
 *
 * Chunking: ~400 tokens (~1600 chars), 80-token overlap (~320 chars).
 * Skips unchanged files via content hash. Includes GC for orphaned chunks,
 * journal rotation (90-day max age), and FTS5 optimize.
 */

import { getPlatform } from "../../platform/platform.ts";
import {
  getJournalDir,
  getMemoryMdPath,
} from "../../common/paths.ts";
import {
  getFileMeta,
  getIndexedFiles,
  getMemoryDb,
  insertChunk,
  optimizeFts,
  removeChunksForFile,
  removeFileMeta,
  setFileMeta,
} from "./search.ts";
import { warnMemory } from "./store.ts";

const CHUNK_SIZE = 1600; // ~400 tokens
const CHUNK_OVERLAP = 320; // ~80 tokens
const JOURNAL_MAX_AGE_DAYS = 90;

/**
 * Simple hash for change detection (FNV-1a variant).
 */
function simpleHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Index a file into the FTS5 search index.
 * Skips unchanged files (checks content hash).
 *
 * @param filePath Absolute path to the file
 * @param date Date string (YYYY-MM-DD) for the file
 */
export function indexFile(filePath: string, date: string): void {
  const fs = getPlatform().fs;

  let content: string;
  try {
    content = fs.readTextFileSync(filePath);
  } catch {
    return; // File doesn't exist or not readable
  }

  const hash = simpleHash(content);
  const existing = getFileMeta(filePath);

  // Skip if content hash unchanged
  if (existing && existing.hash === hash) {
    return;
  }

  const mtime = Date.now();
  const db = getMemoryDb();

  // Atomic: remove old chunks + insert new + update meta in one transaction
  db.exec("BEGIN");
  try {
    removeChunksForFile(filePath);

    // Chunk and insert
    let charPos = 0;
    let lineNum = 0;

    while (charPos < content.length) {
      const chunkEnd = Math.min(charPos + CHUNK_SIZE, content.length);
      const chunkText = content.slice(charPos, chunkEnd);

      // Calculate line numbers for this chunk
      const lineStart = lineNum;
      const chunkLines = chunkText.split("\n").length;
      const lineEnd = lineStart + chunkLines - 1;

      if (chunkText.trim()) {
        insertChunk(filePath, lineStart, lineEnd, chunkText, date);
      }

      // Advance with overlap
      const advance = CHUNK_SIZE - CHUNK_OVERLAP;
      charPos += advance;

      // Update line counter (count newlines in advanced portion)
      const advancedText = content.slice(charPos - advance, charPos);
      const advancedNewlines = (advancedText.match(/\n/g) ?? []).length;
      lineNum += advancedNewlines;
    }

    setFileMeta(filePath, mtime, hash);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Remove chunks and metadata for files that no longer exist on disk.
 * Prevents stale search results from deleted journal files.
 */
async function gcOrphanedChunks(): Promise<void> {
  const fs = getPlatform().fs;
  const indexed = getIndexedFiles();
  if (indexed.length === 0) return;

  const db = getMemoryDb();
  for (const file of indexed) {
    let exists = true;
    try {
      await fs.stat(file);
    } catch {
      exists = false;
    }

    if (!exists) {
      db.exec("BEGIN");
      try {
        removeChunksForFile(file);
        removeFileMeta(file);
        db.exec("COMMIT");
      } catch {
        db.exec("ROLLBACK");
      }
    }
  }
}

/**
 * Delete journal files older than JOURNAL_MAX_AGE_DAYS and remove their index entries.
 */
async function rotateOldJournals(): Promise<void> {
  const fs = getPlatform().fs;
  const journalDir = getJournalDir();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - JOURNAL_MAX_AGE_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const db = getMemoryDb();
  try {
    for await (const entry of fs.readDir(journalDir)) {
      // Only process date-named journals (YYYY-MM-DD.md)
      if (entry.isFile && entry.name.endsWith(".md")) {
        const date = entry.name.replace(".md", "");
        if (date < cutoffStr) {
          const filePath = getPlatform().path.join(journalDir, entry.name);
          db.exec("BEGIN");
          try {
            removeChunksForFile(filePath);
            removeFileMeta(filePath);
            db.exec("COMMIT");
          } catch {
            db.exec("ROLLBACK");
          }
          try { await fs.remove(filePath); } catch { /* best-effort */ }
        }
      }
    }
  } catch {
    // Journal directory might not exist yet
  }
}

/**
 * Reindex all memory files that have changed.
 * Also runs GC for orphaned chunks, journal rotation, and FTS5 optimize.
 * Called on startup and after memory_write.
 * Non-blocking — errors are logged but don't propagate.
 */
export async function reindexMemoryFiles(): Promise<void> {
  try {
    // GC: remove index entries for files that no longer exist on disk
    await gcOrphanedChunks();

    // Rotate: delete journals older than 90 days
    await rotateOldJournals();

    // Index MEMORY.md
    const memoryPath = getMemoryMdPath();
    const today = new Date().toISOString().slice(0, 10);
    indexFile(memoryPath, today);

    // Index journal files
    const journalDir = getJournalDir();
    const fs = getPlatform().fs;

    try {
      for await (const entry of fs.readDir(journalDir)) {
        if (entry.isFile && entry.name.endsWith(".md")) {
          const date = entry.name.replace(".md", "");
          const filePath = getPlatform().path.join(journalDir, entry.name);
          indexFile(filePath, date);
        }
      }
    } catch {
      // Journal directory might not exist yet
    }

    // Optimize FTS5 shadow tables (reduces fragmentation from delete+insert cycles)
    try { optimizeFts(); } catch { /* best-effort */ }
  } catch (error) {
    await warnMemory(`Memory reindex failed: ${error}`);
  }
}
