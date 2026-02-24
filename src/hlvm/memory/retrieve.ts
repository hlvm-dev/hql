/**
 * Hybrid memory retrieval from canonical facts DB.
 */

import { getFactsByIds, searchFactsFts, touchFact, type FactRecord } from "./facts.ts";
import { extractEntitiesFromText, getConnectedFacts } from "./entities.ts";

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
  const sourceFile = fact.source === "journal"
    ? `journal/${date}`
    : `memory/${fact.category || "General"}`;

  return {
    text: fact.content,
    file: sourceFile,
    date,
    score,
    factId: fact.id,
    source,
  };
}

export function retrieveMemory(query: string, limit = 5): RetrievalResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const merged = new Map<number, RetrievalResult>();

  const ftsResults = searchFactsFts(trimmed, Math.max(limit * 3, 12));
  for (const fact of ftsResults) {
    const result = factToResult(fact, Math.max(0.001, fact.bm25Score), "fts");
    const existing = merged.get(fact.id);
    if (!existing || result.score > existing.score) {
      merged.set(fact.id, result);
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
      const boost = base ? Math.max(base.score, 0.2) : 0.2;
      merged.set(fact.id, factToResult(fact, boost, base ? `${base.source}+graph` : "graph"));
    }
  }

  const results = [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  for (const result of results) {
    if (typeof result.factId === "number") touchFact(result.factId);
  }

  return results;
}
