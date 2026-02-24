/**
 * Memory Tools - Persistent memory for agents (DB-first, canonical facts store).
 */

import { ValidationError } from "../../common/error.ts";
import { isToolArgsObject } from "../agent/validation.ts";
import type { ToolMetadata } from "../agent/registry.ts";
import { insertFact, invalidateFactsByCategory, replaceInFacts } from "./facts.ts";
import { retrieveMemory } from "./retrieve.ts";
import { autoInvalidateConflicts, detectConflicts, type MemoryModelTier } from "./invalidate.ts";
import { linkFactEntities } from "./entities.ts";

let _memoryModelTier: MemoryModelTier = "mid";

export function setMemoryModelTier(tier: MemoryModelTier): void {
  _memoryModelTier = tier;
}

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
    throw new ValidationError('target must be "memory" or "journal"', "memory_write");
  }

  const section = typeof record.section === "string" ? record.section.trim() : "";
  const category = section || (target === "journal" ? "Journal" : "General");

  const factId = insertFact({
    content: content.trim(),
    category,
    source: target,
  });

  const linkedEntities = linkFactEntities(factId, content.trim());

  let invalidatedCount = 0;
  if (target === "memory") {
    const conflicts = detectConflicts(content.trim(), category);
    const invalidated = autoInvalidateConflicts(conflicts, _memoryModelTier);
    invalidatedCount = invalidated.length;
  }

  return {
    written: true,
    target,
    section: section || undefined,
    factId,
    linkedEntities,
    invalidated: invalidatedCount,
  };
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

  const results = retrieveMemory(query, limit);
  return {
    query,
    results: results.map((result) => ({
      source: result.file,
      text: result.text,
      date: result.date,
      score: Math.round(result.score * 100) / 100,
    })),
    count: results.length,
  };
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

    const invalidated = invalidateFactsByCategory(section.trim());
    return {
      edited: invalidated > 0,
      action: "delete_section",
      section,
      invalidated,
    };
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

    const count = replaceInFacts(find, replaceWith);
    return { edited: count > 0, action: "replace", replacements: count };
  }

  throw new ValidationError('action must be "delete_section" or "replace"', "memory_edit");
}

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
        'string (optional) - "memory" for durable facts (default), "journal" for transient task context.',
      section:
        'string (optional) - Category for organizing memory (e.g., "Preferences", "Architecture Decisions").',
    },
    returns: {
      written: "boolean",
      target: "string",
      section: "string (if provided)",
      factId: "number",
      linkedEntities: "number",
      invalidated: "number",
    },
    safetyLevel: "L0",
    safety: "Local-only write to canonical memory DB",
  },
  memory_search: {
    fn: memorySearch,
    description:
      "Search persistent memory for facts, decisions, and context from previous conversations. " +
      "Use when user references prior work or when historical context may exist.",
    category: "memory",
    args: {
      query:
        'string - Specific keywords describing what to recall. ' +
        'Good: "CORS bug auth.ts". Bad: "that thing".',
      limit: "number (optional) - Max results to return (default: 5)",
    },
    returns: {
      results: "Array of {source, text, date?, score?}",
      count: "number",
    },
    safetyLevel: "L0",
    safety: "Local-only read from canonical memory DB",
  },
  memory_edit: {
    fn: memoryEdit,
    description:
      "Edit or invalidate stored memory. Use to correct outdated information.",
    category: "memory",
    args: {
      action:
        'string - "delete_section" to invalidate a category, "replace" to find/replace text across active facts.',
      section:
        'string (for delete_section) - Category name to invalidate.',
      find:
        'string (for replace) - Exact text to find in active facts.',
      replace_with:
        'string (for replace) - Replacement text. Use "" to remove matched text.',
    },
    returns: {
      edited: "boolean",
      action: "string",
      replacements: "number (for replace action)",
      invalidated: "number (for delete_section action)",
    },
    safetyLevel: "L0",
    safety: "Local-only edits in canonical memory DB",
  },
};
