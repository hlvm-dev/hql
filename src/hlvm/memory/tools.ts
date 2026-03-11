/**
 * Memory Tools - Persistent memory for agents (DB-first, canonical facts store).
 */

import { ValidationError } from "../../common/error.ts";
import { isToolArgsObject } from "../agent/validation.ts";
import type { ToolMetadata } from "../agent/registry.ts";
import { isObjectValue } from "../../common/utils.ts";
import { invalidateAllFacts, invalidateFactsByCategory, replaceInFacts } from "./facts.ts";
import { retrieveMemory } from "./retrieve.ts";
import { type MemoryModelTier } from "./invalidate.ts";
import { writeMemoryFact } from "./pipeline.ts";

let _memoryModelTier: MemoryModelTier = "mid";

export function setMemoryModelTier(tier: MemoryModelTier): void {
  _memoryModelTier = tier;
}

function memoryWrite(args: unknown): Promise<Record<string, unknown>> {
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

  const section = typeof record.section === "string"
    ? record.section.trim()
    : "";
  const category = section || (target === "journal" ? "Journal" : "General");
  const { factId, linkedEntities, invalidated } = writeMemoryFact({
    content: content.trim(),
    category,
    source: target,
    invalidateConflicts: target === "memory",
    modelTier: _memoryModelTier,
  });

  return Promise.resolve({
    written: true,
    target,
    section: section || undefined,
    factId,
    linkedEntities,
    invalidated,
  });
}

function memorySearch(args: unknown): Promise<Record<string, unknown>> {
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
  return Promise.resolve({
    query,
    results: results.map((result) => ({
      source: result.file,
      text: result.text,
      date: result.date,
      score: Math.round(result.score * 100) / 100,
    })),
    count: results.length,
  });
}

function memoryEdit(args: unknown): Promise<Record<string, unknown>> {
  if (!isToolArgsObject(args)) {
    throw new ValidationError("args must be an object", "memory_edit");
  }

  const record = args as Record<string, unknown>;
  const action = record.action;

  if (action === "delete_section") {
    const section = record.section;
    if (typeof section !== "string" || !section.trim()) {
      throw new ValidationError(
        "section is required for delete_section",
        "memory_edit",
      );
    }

    const invalidated = invalidateFactsByCategory(section.trim());
    return Promise.resolve({
      edited: invalidated > 0,
      action: "delete_section",
      section,
      invalidated,
    });
  }

  if (action === "clear_all") {
    if (record.confirm !== true) {
      throw new ValidationError(
        "clear_all requires confirm: true to prevent accidental data loss",
        "memory_edit",
      );
    }
    const invalidated = invalidateAllFacts();
    return Promise.resolve({
      edited: invalidated > 0,
      action: "clear_all",
      invalidated,
    });
  }

  if (action === "replace") {
    const find = record.find;
    const replaceWith = record.replace_with;
    if (typeof find !== "string" || !find) {
      throw new ValidationError(
        "find is required for replace action",
        "memory_edit",
      );
    }
    if (typeof replaceWith !== "string") {
      throw new ValidationError(
        "replace_with is required for replace action",
        "memory_edit",
      );
    }

    const count = replaceInFacts(find, replaceWith);
    return Promise.resolve({
      edited: count > 0,
      action: "replace",
      replacements: count,
    });
  }

  throw new ValidationError(
    'action must be "delete_section", "replace", or "clear_all"',
    "memory_edit",
  );
}

function formatMemorySearchResult(
  result: unknown,
):
  | { summaryDisplay: string; returnDisplay: string; llmContent?: string }
  | null {
  if (!isObjectValue(result) || !Array.isArray(result.results)) return null;
  const count = typeof result.count === "number"
    ? result.count
    : result.results.length;
  if (count === 0) {
    return {
      summaryDisplay: "No memory results found",
      returnDisplay: "No memory results found",
      llmContent: JSON.stringify(result, null, 2),
    };
  }
  const detailLines = [`Found ${count} memory result${count === 1 ? "" : "s"}`];
  for (let i = 0; i < result.results.length; i++) {
    const entry = result.results[i];
    if (!isObjectValue(entry)) continue;
    const source = typeof entry.source === "string" ? entry.source : "memory";
    const text = typeof entry.text === "string" ? entry.text : "";
    detailLines.push(`[${i + 1}] ${source}`);
    if (text) detailLines.push(`    ${text}`);
  }
  return {
    summaryDisplay: `Found ${count} memory result${count === 1 ? "" : "s"}`,
    returnDisplay: detailLines.join("\n").trimEnd(),
    llmContent: JSON.stringify(result, null, 2),
  };
}

function formatMemoryWriteResult(
  result: unknown,
):
  | { summaryDisplay: string; returnDisplay: string; llmContent?: string }
  | null {
  if (!isObjectValue(result) || result.written !== true) return null;
  const target = typeof result.target === "string" ? result.target : "memory";
  const factId = typeof result.factId === "number" ? result.factId : undefined;
  const detail = factId !== undefined
    ? `Saved to ${target} (#${factId})`
    : `Saved to ${target}`;
  return {
    summaryDisplay: detail,
    returnDisplay: detail,
    llmContent: JSON.stringify(result, null, 2),
  };
}

function formatMemoryEditResult(
  result: unknown,
):
  | { summaryDisplay: string; returnDisplay: string; llmContent?: string }
  | null {
  if (!isObjectValue(result) || result.edited !== true) return null;
  const action = typeof result.action === "string" ? result.action : "edit";
  const detail = action === "clear_all"
    ? `Cleared all memory${
      typeof result.invalidated === "number"
        ? ` (${result.invalidated} facts invalidated)`
        : ""
    }`
    : action === "replace"
    ? `Updated memory${
      typeof result.replacements === "number"
        ? ` (${result.replacements} replacements)`
        : ""
    }`
    : `Updated memory section${
      typeof result.section === "string" ? `: ${result.section}` : ""
    }`;
  return {
    summaryDisplay: detail,
    returnDisplay: detail,
    llmContent: JSON.stringify(result, null, 2),
  };
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
      content: "string - A concise factual statement to remember. " +
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
    formatResult: formatMemoryWriteResult,
  },
  memory_search: {
    fn: memorySearch,
    description:
      "Search persistent memory for facts, decisions, and context from previous conversations. " +
      "Use when user references prior work or when historical context may exist.",
    category: "memory",
    args: {
      query: "string - Specific keywords describing what to recall. " +
        'Good: "CORS bug auth.ts". Bad: "that thing".',
      limit: "number (optional) - Max results to return (default: 5)",
    },
    returns: {
      results: "Array of {source, text, date?, score?}",
      count: "number",
    },
    safetyLevel: "L0",
    safety: "Local-only read from canonical memory DB",
    formatResult: formatMemorySearchResult,
  },
  memory_edit: {
    fn: memoryEdit,
    description:
      "Edit or invalidate stored memory. Use to correct outdated information.",
    category: "memory",
    args: {
      action:
        'string - "delete_section" to invalidate a category, "replace" to find/replace text across active facts, "clear_all" to wipe all stored facts (requires confirm: true).',
      section: "string (for delete_section) - Category name to invalidate.",
      find: "string (for replace) - Exact text to find in active facts.",
      replace_with:
        'string (for replace) - Replacement text. Use "" to remove matched text.',
      confirm:
        "boolean (for clear_all) - Must be true to confirm deletion of all facts.",
    },
    returns: {
      edited: "boolean",
      action: "string",
      replacements: "number (for replace action)",
      invalidated: "number (for delete_section and clear_all actions)",
    },
    safetyLevel: "L0",
    safety: "Local-only edits in canonical memory DB",
    formatResult: formatMemoryEditResult,
  },
};
