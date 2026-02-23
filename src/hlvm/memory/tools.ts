/**
 * Memory Tools - Persistent memory for agents
 *
 * Provides:
 * - memory_write: proactively store facts, decisions, preferences
 * - memory_search: FTS5-powered search with substring fallback
 */

import { ValidationError } from "../../common/error.ts";
import { isToolArgsObject } from "../agent/validation.ts";
import type { ToolMetadata } from "../agent/registry.ts";
import { appendToJournal, appendToMemoryMd, readMemoryMd, readRecentJournals } from "./store.ts";
import { searchMemory as ftsSearch } from "./search.ts";
import { indexFile } from "./indexer.ts";
import { getPlatform } from "../../platform/platform.ts";
import { getJournalDir, getMemoryMdPath } from "../../common/paths.ts";

// ============================================================
// Helpers
// ============================================================

/** Scan lines for needle with ±1 line of context. Mutates results array. */
function substringSearchLines(
  lines: string[],
  needle: string,
  source: string,
  limit: number,
  results: { source: string; text: string }[],
): void {
  for (let i = 0; i < lines.length && results.length < limit; i++) {
    if (lines[i].toLowerCase().includes(needle)) {
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + 2);
      results.push({ source, text: lines.slice(start, end).join("\n") });
      i = end - 1;
    }
  }
}

// ============================================================
// Tool Implementations
// ============================================================

async function memoryWrite(args: unknown): Promise<Record<string, unknown>> {
  if (!isToolArgsObject(args)) {
    throw new ValidationError("args must be an object", "memory_write");
  }
  const record = args as Record<string, unknown>;
  const content = record.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new ValidationError("content is required", "memory_write");
  }

  const target = typeof record.target === "string" ? record.target : "memory";
  if (target !== "memory" && target !== "journal") {
    throw new ValidationError(
      'target must be "memory" or "journal"',
      "memory_write",
    );
  }

  const section = typeof record.section === "string" ? record.section : undefined;

  if (target === "journal") {
    await appendToJournal(content.trim());
    // Targeted reindex: only the changed journal file (not full scan)
    const today = new Date().toISOString().slice(0, 10);
    const journalPath = getPlatform().path.join(getJournalDir(), `${today}.md`);
    try { indexFile(journalPath, today); } catch { /* best-effort */ }
  } else {
    await appendToMemoryMd(content.trim(), section);
    // Targeted reindex: only MEMORY.md (not full scan)
    try { indexFile(getMemoryMdPath(), new Date().toISOString().slice(0, 10)); } catch { /* best-effort */ }
  }

  return { written: true, target, section };
}

async function memorySearch(args: unknown): Promise<Record<string, unknown>> {
  if (!isToolArgsObject(args)) {
    throw new ValidationError("args must be an object", "memory_search");
  }
  const record = args as Record<string, unknown>;
  const query = record.query;
  if (typeof query !== "string" || query.trim() === "") {
    throw new ValidationError("query is required", "memory_search");
  }

  const limit = typeof record.limit === "number" && record.limit > 0
    ? record.limit
    : 5;

  // Try FTS5 search first
  try {
    const ftsResults = ftsSearch(query, limit);
    if (ftsResults.length > 0) {
      return {
        query,
        results: ftsResults.map((r) => ({
          source: r.file,
          text: r.text,
          date: r.date,
          score: Math.round(r.score * 100) / 100,
        })),
        count: ftsResults.length,
      };
    }
  } catch {
    // FTS5 not available or empty — fall through to substring search
  }

  // Fallback: substring search across MEMORY.md + recent journals
  const needle = query.trim().toLowerCase();
  const results: { source: string; text: string }[] = [];

  const memoryMd = await readMemoryMd();
  if (memoryMd) {
    substringSearchLines(memoryMd.split("\n"), needle, "MEMORY.md", limit, results);
  }

  if (results.length < limit) {
    const journals = await readRecentJournals(7);
    for (const journal of journals) {
      if (results.length >= limit) break;
      substringSearchLines(
        journal.content.split("\n"), needle,
        `journal/${journal.date}`, limit, results,
      );
    }
  }

  return { query, results, count: results.length };
}

// ============================================================
// Tool Definitions
// ============================================================

export const MEMORY_TOOLS: Record<string, ToolMetadata> = {
  memory_write: {
    fn: memoryWrite,
    description:
      "Write important facts, decisions, preferences, or outcomes to persistent memory. Call proactively when the user makes decisions, expresses preferences, solves problems, or asks you to remember something. Memory persists across conversations.",
    category: "memory",
    args: {
      content: "string - Content to remember (facts, decisions, preferences)",
      target:
        'string (optional) - "memory" for permanent facts (default), "journal" for session context',
      section:
        'string (optional) - Section name in MEMORY.md to file under (only for target="memory")',
    },
    returns: {
      written: "boolean",
      target: "string",
      section: "string (if provided)",
    },
    safetyLevel: "L0",
    safety: "Local-only write to ~/.hlvm/memory/",
  },
  memory_search: {
    fn: memorySearch,
    description:
      "Search persistent memory for previously stored facts, decisions, and context. Use when you need to recall information from past conversations.",
    category: "memory",
    args: {
      query: "string - Search query",
      limit: "number (optional) - Max results (default: 5)",
    },
    returns: {
      results: "Array of {source, text, date?, score?}",
      count: "number",
    },
    safetyLevel: "L0",
    safety: "Local-only read from ~/.hlvm/memory/",
  },
};
