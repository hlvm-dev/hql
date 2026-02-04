/**
 * Memory Tools - persistent local memory for agents
 *
 * Provides:
 * - memory_add: store a memory entry
 * - memory_search: search memory entries
 * - memory_list: list recent memory entries
 * - memory_clear: clear memory
 */

import { ValidationError } from "../../../common/error.ts";
import { isToolArgsObject } from "../validation.ts";
import type { ToolMetadata } from "../registry.ts";
import {
  addMemoryEntry,
  clearMemory,
  listMemoryEntries,
  searchMemory,
  type MemoryEntry,
} from "../memory-store.ts";

async function memoryAdd(args: unknown): Promise<MemoryEntry> {
  if (!isToolArgsObject(args)) {
    throw new ValidationError("args must be an object", "memory_add");
  }
  const record = args as Record<string, unknown>;
  const content = record.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new ValidationError("content is required", "memory_add");
  }
  const normalizedTags = Array.isArray(record.tags)
    ? (record.tags as unknown[]).filter((t) =>
      typeof t === "string" && t.trim().length > 0
    ) as string[]
    : undefined;
  const entry = await addMemoryEntry(content, normalizedTags);
  return entry;
}

async function memorySearch(args: unknown): Promise<Record<string, unknown>> {
  if (!isToolArgsObject(args)) {
    throw new ValidationError("args must be an object", "memory_search");
  }
  const record = args as Record<string, unknown>;
  const query = record.query;
  const limit = typeof record.limit === "number" ? record.limit : undefined;
  if (typeof query !== "string" || query.trim() === "") {
    throw new ValidationError("query is required", "memory_search");
  }
  const results = await searchMemory({ query, limit });
  return { query, results, count: results.length };
}

async function memoryList(args: unknown): Promise<Record<string, unknown>> {
  if (!isToolArgsObject(args)) {
    throw new ValidationError("args must be an object", "memory_list");
  }
  const record = args as Record<string, unknown>;
  const limit = record.limit;
  const results = await listMemoryEntries(
    typeof limit === "number" && limit > 0 ? limit : 50,
  );
  return { results, count: results.length };
}

async function memoryClear(): Promise<Record<string, unknown>> {
  await clearMemory();
  return { cleared: true };
}

export const MEMORY_TOOLS: Record<string, ToolMetadata> = {
  memory_add: {
    fn: async (args) => await memoryAdd(args),
    description: "Store a memory entry for future retrieval",
    args: {
      content: "string - Memory content to store",
      tags: "string[] (optional) - Tags for retrieval",
    },
    returns: {
      id: "string",
      content: "string",
      tags: "string[]",
      createdAt: "string",
    },
    safetyLevel: "L0",
    safety: "Local-only write to ~/.hlvm/agent-memory.jsonl",
  },
  memory_search: {
    fn: async (args) => await memorySearch(args),
    description: "Search stored memory entries by query",
    args: {
      query: "string - Search query",
      limit: "number (optional) - Max results (default: 5)",
    },
    returns: {
      results: "MemoryEntry[]",
      count: "number",
    },
    safetyLevel: "L0",
    safety: "Local-only read from ~/.hlvm/agent-memory.jsonl",
  },
  memory_list: {
    fn: async (args) => await memoryList(args),
    description: "List recent memory entries",
    args: {
      limit: "number (optional) - Max results (default: 50)",
    },
    returns: {
      results: "MemoryEntry[]",
      count: "number",
    },
    safetyLevel: "L0",
    safety: "Local-only read from ~/.hlvm/agent-memory.jsonl",
  },
  memory_clear: {
    fn: async () => await memoryClear(),
    description: "Clear all stored memory entries",
    args: {},
    returns: {
      cleared: "boolean",
    },
    safetyLevel: "L1",
    safety: "Local-only delete of ~/.hlvm/agent-memory.jsonl",
  },
};
