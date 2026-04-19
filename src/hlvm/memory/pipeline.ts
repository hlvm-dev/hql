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
import { type ModelCapabilityClass } from "../agent/constants.ts";
import { normalizeWhitespace } from "./store.ts";

export interface WriteMemoryFactOptions extends InsertFactOptions {
  linkEntities?: boolean;
  invalidateConflicts?: boolean;
  modelCapability?: ModelCapabilityClass;
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

type ConflictCandidates = Awaited<ReturnType<typeof detectConflicts>>;

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

let detectConflictsForWrite: typeof detectConflicts = detectConflicts;

async function precomputeConflictCandidates(
  normalized: WriteMemoryFactOptions,
): Promise<ConflictCandidates> {
  if (normalized.invalidateConflicts !== true) return [];
  return await detectConflictsForWrite(
    normalized.content,
    normalized.category ?? "General",
  );
}

export function __testOnlySetDetectConflictsForWrite(
  fn: typeof detectConflicts,
): void {
  detectConflictsForWrite = fn;
}

export function __testOnlyResetWriteMemoryFactDependencies(): void {
  detectConflictsForWrite = detectConflicts;
}

export async function writeMemoryFact(
  opts: WriteMemoryFactOptions,
): Promise<WriteMemoryFactResult> {
  const normalized = normalizeWriteOptions(opts);
  const existing = findExactActiveFact(
    normalized.content,
    normalized.category ?? "General",
  );
  if (existing) {
    return { factId: existing.id, linkedEntities: 0, invalidated: 0 };
  }
  const conflictCandidates = await precomputeConflictCandidates(normalized);
  const factId = await insertFactRecord(normalized);
  const linkedEntities = normalized.linkEntities === false
    ? 0
    : linkFactEntities(factId, normalized.content);
  const invalidated = normalized.invalidateConflicts === true
    ? autoInvalidateConflicts(
      conflictCandidates,
      normalized.modelCapability ?? "agent",
    ).length
    : 0;

  return { factId, linkedEntities, invalidated };
}

export async function writeMemoryFacts(
  entries: WriteMemoryFactOptions[],
): Promise<WriteMemoryFactsResult> {
  let linkedEntities = 0;
  let invalidated = 0;
  const factIds: number[] = [];

  for (const entry of dedupeWriteOptions(entries)) {
    const result = await writeMemoryFact(entry);
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
export async function insertFact(
  opts: InsertFactOptions & { modelCapability?: ModelCapabilityClass },
): Promise<number> {
  const result = await writeMemoryFact({
    ...opts,
    linkEntities: true,
    invalidateConflicts: false,
  });
  return result.factId;
}
