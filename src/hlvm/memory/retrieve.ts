/**
 * Hybrid memory retrieval from canonical facts DB.
 */

import { getFactsByIds, searchFactsFts, touchFact, type FactRecord } from "./facts.ts";
import { extractEntitiesFromText, getConnectedFacts } from "./entities.ts";

const HALF_LIFE_DAYS = 30;
const DECAY_LAMBDA = Math.log(0.5) / HALF_LIFE_DAYS;

/** Exponential decay with 30-day half-life. Returns 1.0 for now, 0.5 at 30 days, 0.25 at 60 days. */
export function temporalDecay(createdAtUnix: number): number {
  const ageDays = (Date.now() / 1000 - createdAtUnix) / 86400;
  if (ageDays <= 0) return 1;
  return Math.exp(DECAY_LAMBDA * ageDays);
}

/** Diminishing-returns boost from access frequency. Returns 1.0 for 0 accesses, ~1.69 for 1, ~2.1 for 2. */
export function accessBoost(accessCount: number): number {
  return 1 + Math.log(1 + Math.max(0, accessCount));
}

export interface RetrievalResult {
  text: string;
  file: string;
  date: string;
  score: number;
  factId?: number;
  source?: string;
}

function factToResult(fact: FactRecord, score: number, source: string): RetrievalResult {
  const date = fact.validFrom || new Date(fact.createdAt * 1000).toISOString().slice(0, 10);
  const sourceFile = `memory/${fact.category || "General"}`;

  return {
    text: fact.content,
    file: sourceFile,
    date,
    score,
    factId: fact.id,
    source,
  };
}

interface MergeEntry {
  result: RetrievalResult;
  createdAt: number;
  accessCount: number;
}

export function retrieveMemory(query: string, limit = 5): RetrievalResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const merged = new Map<number, MergeEntry>();

  const ftsResults = searchFactsFts(trimmed, Math.max(limit * 3, 12));
  for (const fact of ftsResults) {
    const result = factToResult(fact, Math.max(0.001, fact.bm25Score), "fts");
    const existing = merged.get(fact.id);
    if (!existing || result.score > existing.result.score) {
      merged.set(fact.id, { result, createdAt: fact.createdAt, accessCount: fact.accessCount });
    }
  }

  const entities = extractEntitiesFromText(trimmed);
  const connectedFactIds = new Set<number>();
  for (const entity of entities) {
    for (const factId of getConnectedFacts(entity.name, 8)) {
      connectedFactIds.add(factId);
    }
  }

  if (connectedFactIds.size > 0) {
    const connectedFacts = getFactsByIds([...connectedFactIds]);
    for (const fact of connectedFacts) {
      const base = merged.get(fact.id);
      const rawScore = base ? Math.max(base.result.score, 0.2) : 0.2;
      const source = base ? `${base.result.source}+graph` : "graph";
      merged.set(fact.id, {
        result: factToResult(fact, rawScore, source),
        createdAt: fact.createdAt,
        accessCount: fact.accessCount,
      });
    }
  }

  const results = [...merged.values()]
    .map((entry) => {
      const decay = temporalDecay(entry.createdAt);
      const boost = accessBoost(entry.accessCount);
      return { ...entry.result, score: entry.result.score * decay * boost };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  for (const result of results) {
    if (typeof result.factId === "number") touchFact(result.factId);
  }

  return results;
}
