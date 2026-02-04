/**
 * Agent Memory Store - Local, persistent memory for agents
 *
 * JSONL append-only store under ~/.hlvm/agent-memory.jsonl
 *
 * SSOT: uses platform abstraction + common/paths.ts.
 */

import { getPlatform } from "../../platform/platform.ts";
import { getAgentMemoryPath } from "../../common/paths.ts";
import { ValidationError } from "../../common/error.ts";
import { getErrorMessage, isObjectValue } from "../../common/utils.ts";

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

async function readAllEntries(): Promise<MemoryEntry[]> {
  const platform = getPlatform();
  const path = getAgentMemoryPath();
  try {
    const raw = await platform.fs.readTextFile(path);
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const entries: MemoryEntry[] = [];
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isObjectValue(parsed)) continue;
      const content = typeof parsed.content === "string"
        ? parsed.content
        : "";
      if (!content) continue;
      const tags = Array.isArray(parsed.tags)
        ? parsed.tags.filter((tag) => typeof tag === "string" && tag.trim().length > 0)
        : undefined;
      const id = typeof parsed.id === "string" && parsed.id.length > 0
        ? parsed.id
        : makeId();
      const createdAt = typeof parsed.createdAt === "string" && parsed.createdAt.length > 0
        ? parsed.createdAt
        : new Date().toISOString();
      entries.push({ id, content, tags, createdAt });
    }
    return entries;
  } catch (error) {
    if (String(error).includes("No such file") || String(error).includes("not found")) {
      return [];
    }
    throw new ValidationError(
      `Failed to read agent memory: ${getErrorMessage(error)}`,
      "agent_memory",
    );
  }
}

async function appendEntry(entry: MemoryEntry): Promise<void> {
  const platform = getPlatform();
  const path = getAgentMemoryPath();
  const line = JSON.stringify(entry) + "\n";
  await platform.fs.writeTextFile(path, line, { append: true, create: true });
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
    throw new ValidationError("memory content must be non-empty", "agent_memory");
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
  const matches = entries.filter((entry) => {
    if (entry.content.toLowerCase().includes(needle)) return true;
    if (entry.tags?.some((tag) => tag.toLowerCase().includes(needle))) return true;
    return false;
  });
  return matches.slice(0, limit);
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
