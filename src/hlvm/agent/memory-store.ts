/**
 * Agent Memory Store - Local, persistent memory for agents
 *
 * JSONL append-only store under ~/.hlvm/agent-memory.jsonl
 *
 * SSOT: uses platform abstraction + common/paths.ts.
 */

import { getPlatform } from "../../platform/platform.ts";
import { getAgentMemoryPath } from "../../common/paths.ts";
import { appendJsonLine, readJsonLines } from "../../common/jsonl.ts";
import { ValidationError } from "../../common/error.ts";
import {
  getErrorMessage,
  isFileNotFoundError,
  isObjectValue,
} from "../../common/utils.ts";

// ============================================================
// Types
// ============================================================

export interface MemoryEntry {
  id: string;
  content: string;
  tags?: string[];
  createdAt: string;
}

interface MemoryQuery {
  query: string;
  limit?: number;
}

// ============================================================
// Core helpers
// ============================================================

function makeId(): string {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : String(Date.now());
}

function toMemoryEntry(value: unknown): MemoryEntry | undefined {
  if (!isObjectValue(value)) return undefined;
  const content = typeof value.content === "string" ? value.content : "";
  if (!content) return undefined;

  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag) =>
      typeof tag === "string" && tag.trim().length > 0
    )
    : undefined;

  const id = typeof value.id === "string" && value.id.length > 0
    ? value.id
    : makeId();
  const createdAt =
    typeof value.createdAt === "string" && value.createdAt.length > 0
      ? value.createdAt
      : new Date().toISOString();

  return { id, content, tags, createdAt };
}

async function readAllEntries(): Promise<MemoryEntry[]> {
  const path = getAgentMemoryPath();
  try {
    return await readJsonLines(path, toMemoryEntry);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }
    throw new ValidationError(
      `Failed to read agent memory: ${getErrorMessage(error)}`,
      "agent_memory",
    );
  }
}

async function appendEntry(entry: MemoryEntry): Promise<void> {
  const path = getAgentMemoryPath();
  await appendJsonLine(path, entry);
}

// ============================================================
// API
// ============================================================

export async function addMemoryEntry(
  content: string,
  tags?: string[],
): Promise<MemoryEntry> {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new ValidationError(
      "memory content must be non-empty",
      "agent_memory",
    );
  }
  const entry: MemoryEntry = {
    id: makeId(),
    content: trimmed,
    tags: tags && tags.length > 0 ? tags : undefined,
    createdAt: new Date().toISOString(),
  };
  await appendEntry(entry);
  return entry;
}

export async function searchMemory(
  query: MemoryQuery,
): Promise<MemoryEntry[]> {
  const needle = query.query.trim().toLowerCase();
  if (!needle) return [];
  const limit = typeof query.limit === "number" && query.limit > 0
    ? query.limit
    : 5;
  const entries = await readAllEntries();
  // Early termination: stop scanning once we have enough matches
  const matches: MemoryEntry[] = [];
  for (const entry of entries) {
    if (
      entry.content.toLowerCase().includes(needle) ||
      entry.tags?.some((tag) => tag.toLowerCase().includes(needle))
    ) {
      matches.push(entry);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

export async function listMemoryEntries(limit = 50): Promise<MemoryEntry[]> {
  const entries = await readAllEntries();
  return entries.slice(-limit);
}

export async function clearMemory(): Promise<void> {
  const platform = getPlatform();
  const path = getAgentMemoryPath();
  await platform.fs.writeTextFile(path, "");
}
