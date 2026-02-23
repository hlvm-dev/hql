/**
 * Memory Indexer - Chunks files and inserts into FTS5 index
 *
 * Chunking: ~400 tokens (~1600 chars), 80-token overlap (~320 chars).
 * Skips unchanged files via meta table (mtime + hash).
 */

import { getPlatform } from "../../platform/platform.ts";
import {
  getJournalDir,
  getMemoryMdPath,
} from "../../common/paths.ts";
import {
  getFileMeta,
  insertChunk,
  removeChunksForFile,
  setFileMeta,
} from "./search.ts";
import { warnMemory } from "./store.ts";

const CHUNK_SIZE = 1600; // ~400 tokens
const CHUNK_OVERLAP = 320; // ~80 tokens

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
 * Skips unchanged files (checks mtime + hash).
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

  // Remove old chunks for this file
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

  // Update metadata
  setFileMeta(filePath, mtime, hash);
}

/**
 * Reindex all memory files that have changed.
 * Called on startup and after memory_write.
 * Non-blocking — errors are logged but don't propagate.
 */
export async function reindexMemoryFiles(): Promise<void> {
  try {
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
  } catch (error) {
    await warnMemory(`Memory reindex failed: ${error}`);
  }
}
