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
import {
  appendToJournal,
  appendToMemoryMd,
  readMemoryMd,
  readRecentJournals,
  removeSectionFromMemoryMd,
  replaceInMemoryMd,
} from "./store.ts";
import { searchMemory as ftsSearch } from "./search.ts";
import { indexFile } from "./indexer.ts";
import { getPlatform } from "../../platform/platform.ts";
import { getJournalDir, getMemoryMdPath } from "../../common/paths.ts";

// ============================================================
// Helpers
// ============================================================

/** Scan lines for needle with ±1 line of context. Mutates results array.
 *  Uses word-AND semantics: ALL words must appear in the line (matches FTS5 behavior). */
function substringSearchLines(
  lines: string[],
  needle: string,
  source: string,
  limit: number,
  results: { source: string; text: string }[],
): void {
  const words = needle.split(/\s+/).filter(Boolean);
  for (let i = 0; i < lines.length && results.length < limit; i++) {
    const lower = lines[i].toLowerCase();
    if (words.every((w) => lower.includes(w))) {
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
    const journals = await readRecentJournals(30);
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

async function memoryEdit(args: unknown): Promise<Record<string, unknown>> {
  if (!isToolArgsObject(args)) {
    throw new ValidationError("args must be an object", "memory_edit");
  }
  const record = args as Record<string, unknown>;
  const action = record.action;

  if (action === "delete_section") {
    const section = record.section;
    if (typeof section !== "string" || !section.trim()) {
      throw new ValidationError("section is required for delete_section", "memory_edit");
    }
    const removed = await removeSectionFromMemoryMd(section.trim());
    if (removed) {
      try { indexFile(getMemoryMdPath(), new Date().toISOString().slice(0, 10)); } catch { /* best-effort */ }
    }
    return { edited: removed, action: "delete_section", section };
  }

  if (action === "replace") {
    const find = record.find;
    const replaceWith = record.replace_with;
    if (typeof find !== "string" || !find) {
      throw new ValidationError("find is required for replace action", "memory_edit");
    }
    if (typeof replaceWith !== "string") {
      throw new ValidationError("replace_with is required for replace action", "memory_edit");
    }
    const count = await replaceInMemoryMd(find, replaceWith);
    if (count > 0) {
      try { indexFile(getMemoryMdPath(), new Date().toISOString().slice(0, 10)); } catch { /* best-effort */ }
    }
    return { edited: count > 0, action: "replace", replacements: count };
  }

  throw new ValidationError('action must be "delete_section" or "replace"', "memory_edit");
}

// ============================================================
// Tool Definitions
// ============================================================

export const MEMORY_TOOLS: Record<string, ToolMetadata> = {
  memory_write: {
    fn: memoryWrite,
    description:
      "Save important information to persistent memory that survives across conversations. " +
      "Call proactively when you learn:\n" +
      "- User preferences (coding style, tools, conventions, workflows)\n" +
      "- Project decisions (architecture choices, why X over Y, trade-offs made)\n" +
      "- Bugs found and how they were fixed\n" +
      "- Environment details (OS, runtime versions, deployment targets)\n" +
      "- The user explicitly asks you to remember something\n" +
      "Do NOT save: trivial/temporary info, things already in the codebase, " +
      "or raw code snippets (reference file paths instead).",
    category: "memory",
    args: {
      content:
        'string - A concise factual statement to remember. ' +
        'Good: "User prefers Deno over Node for all new projects". ' +
        'Good: "Auth uses JWT with 1h expiry — decided 2026-02-20 over session cookies for statelessness". ' +
        'Bad: "The user said they like Deno I think maybe". ' +
        'Bad: "We talked about some auth stuff today".',
      target:
        'string (optional) - "memory" for permanent facts (default), "journal" for session-specific context. ' +
        'Use "memory" for preferences and decisions that matter long-term. ' +
        'Use "journal" for today\'s working context (current task, files being edited, debugging notes).',
      section:
        'string (optional) - Section heading in MEMORY.md to organize under (only for target="memory"). ' +
        'Good: "Preferences", "Architecture Decisions", "Environment". ' +
        'Omit if unsure — content appends to the end.',
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
      "Search persistent memory for facts, decisions, and context from previous conversations. " +
      "Call this when:\n" +
      '- User references something from a past conversation ("remember when we...", "what was that...")\n' +
      "- You need context about a prior decision, bug fix, or preference\n" +
      "- User mentions a topic that might have history (check before assuming)\n" +
      "- Starting work on a feature/file that was discussed before\n" +
      "Do NOT call for things in the current conversation (you already have that in context).",
    category: "memory",
    args: {
      query:
        'string - Short specific keyword search. Use concrete terms, not vague phrases. ' +
        'Good: "CORS bug auth.ts". ' +
        'Good: "database migration decision". ' +
        'Good: "preferred test framework". ' +
        'Bad: "that thing we talked about". ' +
        'Bad: "everything about the project".',
      limit: "number (optional) - Max results to return (default: 5)",
    },
    returns: {
      results: "Array of {source, text, date?, score?}",
      count: "number",
    },
    safetyLevel: "L0",
    safety: "Local-only read from ~/.hlvm/memory/",
  },
  memory_edit: {
    fn: memoryEdit,
    description:
      "Edit or delete content in persistent memory (MEMORY.md). " +
      "Use this to correct mistakes, remove outdated information, or update facts.\n" +
      "Actions:\n" +
      '- "delete_section": Remove an entire ## section from MEMORY.md\n' +
      '- "replace": Find and replace text in MEMORY.md\n' +
      "Call this when:\n" +
      "- Previously stored information is now wrong or outdated\n" +
      "- User explicitly asks to forget or correct something\n" +
      "- A section has grown too large and needs cleanup",
    category: "memory",
    args: {
      action:
        'string - "delete_section" to remove a whole section, "replace" to find/replace text.',
      section:
        'string (for delete_section) - The section name to remove (e.g., "Old Decisions"). ' +
        "Matches ## heading exactly.",
      find:
        'string (for replace) - The exact text to find in MEMORY.md.',
      replace_with:
        'string (for replace) - The replacement text. Use "" to delete the matched text.',
    },
    returns: {
      edited: "boolean - true if changes were made",
      action: "string",
      replacements: "number (for replace action)",
    },
    safetyLevel: "L0",
    safety: "Local-only edit of ~/.hlvm/memory/MEMORY.md",
  },
};
