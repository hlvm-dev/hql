/**
 * Shared memory write pipeline used by chat, tools, and extractors.
 */

import {
  findExactActiveFact,
  insertFact as insertFactRecord,
  type InsertFactOptions,
} from "./facts.ts";
import { linkFactEntities } from "./entities.ts";
import {
  autoInvalidateConflicts,
  detectConflicts,
} from "./invalidate.ts";
import { type ModelTier } from "../agent/constants.ts";
import { normalizeWhitespace } from "./store.ts";

export interface WriteMemoryFactOptions extends InsertFactOptions {
  linkEntities?: boolean;
  invalidateConflicts?: boolean;
  modelTier?: ModelTier;
}

interface WriteMemoryFactResult {
  factId: number;
  linkedEntities: number;
  invalidated: number;
}

interface WriteMemoryFactsResult {
  written: number;
  linkedEntities: number;
  invalidated: number;
  factIds: number[];
}

function normalizeWriteOptions(
  opts: WriteMemoryFactOptions,
): WriteMemoryFactOptions {
  return {
    ...opts,
    content: typeof opts.content === "string"
      ? normalizeWhitespace(opts.content)
      : "",
    category: opts.category?.trim() || "General",
    source: opts.source?.trim() || "memory",
  };
}

function dedupeWriteOptions(
  entries: WriteMemoryFactOptions[],
): WriteMemoryFactOptions[] {
  const seen = new Set<string>();
  const deduped: WriteMemoryFactOptions[] = [];

  for (const entry of entries.map(normalizeWriteOptions)) {
    if (!entry.content) continue;
    const key =
      `${entry.category}\u0000${entry.source}\u0000${entry.content.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

export function writeMemoryFact(
  opts: WriteMemoryFactOptions,
): WriteMemoryFactResult {
  const normalized = normalizeWriteOptions(opts);
  const existing = findExactActiveFact(
    normalized.content,
    normalized.category ?? "General",
  );
  if (existing) {
    return { factId: existing.id, linkedEntities: 0, invalidated: 0 };
  }
  const factId = insertFactRecord(normalized);
  const linkedEntities = normalized.linkEntities === false
    ? 0
    : linkFactEntities(factId, normalized.content);
  const invalidated = normalized.invalidateConflicts === true
    ? autoInvalidateConflicts(
      detectConflicts(normalized.content, normalized.category ?? "General"),
      normalized.modelTier ?? "standard",
    ).length
    : 0;

  return { factId, linkedEntities, invalidated };
}

export function writeMemoryFacts(
  entries: WriteMemoryFactOptions[],
): WriteMemoryFactsResult {
  let linkedEntities = 0;
  let invalidated = 0;
  const factIds: number[] = [];

  for (const entry of dedupeWriteOptions(entries)) {
    const result = writeMemoryFact(entry);
    factIds.push(result.factId);
    linkedEntities += result.linkedEntities;
    invalidated += result.invalidated;
  }

  return {
    written: factIds.length,
    linkedEntities,
    invalidated,
    factIds,
  };
}

/**
 * Canonical public insert used by external consumers via memory/mod.ts.
 * Internal callers that need raw DB-only insertion should import from facts.ts.
 */
export function insertFact(
  opts: InsertFactOptions & { modelTier?: ModelTier },
): number {
  return writeMemoryFact({
    ...opts,
    linkEntities: true,
    invalidateConflicts: false,
  }).factId;
}
