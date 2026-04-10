/**
 * Entity and relationship operations for memory graph traversal.
 */

import { getFactDb } from "./db.ts";
import { withTransaction } from "./facts.ts";
import { todayDate } from "./store.ts";

export interface ExtractedEntity {
  name: string;
  type: string;
}

const RUNTIMES = new Set([
  "deno",
  "node",
  "bun",
  "python",
  "ruby",
  "go",
  "rust",
]);
const TOOLS = new Set([
  "redis",
  "postgres",
  "postgresql",
  "mysql",
  "sqlite",
  "vitest",
  "jest",
  "docker",
]);

function upsertEntity(name: string, type: string): number {
  const cleaned = name.trim();
  if (!cleaned) return 0;

  const db = getFactDb();
  db.prepare("INSERT OR IGNORE INTO entities(name, type) VALUES(?, ?)").run(
    cleaned,
    type,
  );
  const row = db.prepare("SELECT id FROM entities WHERE name = ?").value<
    [number]
  >(cleaned);
  return row?.[0] ?? 0;
}

const FILE_EXT_RE =
  /\b[\w./-]+\.(?:ts|tsx|js|jsx|json|md|yaml|yml|sql|sh)\b/g;
const WORD_RE = /\b[A-Za-z][\w-]{2,}\b/g;
const PASCAL_CASE_RE = /^[A-Z][A-Za-z0-9_]+$/;
const CAMEL_CASE_RE = /^[a-z]+[A-Z][A-Za-z0-9_]*$/;

export function extractEntitiesFromText(text: string): ExtractedEntity[] {
  const out = new Map<string, ExtractedEntity>();
  const add = (name: string, type: string) => {
    const cleaned = name.trim();
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (!out.has(key)) out.set(key, { name: cleaned, type });
  };

  const fileMatches = text.match(FILE_EXT_RE) ?? [];
  for (const match of fileMatches) add(match, "file");

  const wordMatches = text.match(WORD_RE) ?? [];
  for (const word of wordMatches) {
    const lower = word.toLowerCase();
    if (RUNTIMES.has(lower)) {
      add(word, "runtime");
      continue;
    }
    if (TOOLS.has(lower)) {
      add(word, "tool");
      continue;
    }
    if (PASCAL_CASE_RE.test(word) || CAMEL_CASE_RE.test(word)) {
      add(word, "concept");
    }
  }

  return [...out.values()];
}

export function linkFactEntities(factId: number, text: string): number {
  const entities = extractEntitiesFromText(text);
  if (entities.length === 0) return 0;

  return withTransaction(() => {
    const db = getFactDb();
    const entityIds: number[] = [];
    for (const entity of entities) {
      const entityId = upsertEntity(entity.name, entity.type);
      if (entityId) entityIds.push(entityId);
    }

    // Re-linking the same fact should be a no-op so chat and tool flows can
    // safely share the same writer without duplicating graph edges.
    const insertRel = db.prepare(
      `INSERT INTO relationships(from_entity, to_entity, relation, fact_id, valid_from)
       SELECT ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1
         FROM relationships
         WHERE from_entity = ?
           AND to_entity = ?
           AND relation = ?
           AND fact_id = ?
           AND valid_until IS NULL
       )`,
    );
    const today = todayDate();

    // Link each entity to the fact (self-loop records "entity appears in fact")
    for (const entityId of entityIds) {
      insertRel.run(
        entityId,
        entityId,
        "appears_in",
        factId,
        today,
        entityId,
        entityId,
        "appears_in",
        factId,
      );
    }

    // Link co-occurring entities to each other (batched to avoid O(n²) individual INSERTs)
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < entityIds.length; i++) {
      for (let j = i + 1; j < entityIds.length; j++) {
        pairs.push([entityIds[i], entityIds[j]]);
      }
    }
    const BATCH_SIZE = 50;
    for (let offset = 0; offset < pairs.length; offset += BATCH_SIZE) {
      const batch = pairs.slice(offset, offset + BATCH_SIZE);
      const placeholders = batch.map(() =>
        `SELECT ?, ?, 'co_occurs', ?, ? WHERE NOT EXISTS (
           SELECT 1 FROM relationships
           WHERE from_entity = ? AND to_entity = ? AND relation = 'co_occurs'
             AND fact_id = ? AND valid_until IS NULL
         )`
      ).join(" UNION ALL ");
      const params: Array<number | string> = [];
      for (const [a, b] of batch) {
        params.push(a, b, factId, today, a, b, factId);
      }
      db.prepare(`INSERT INTO relationships(from_entity, to_entity, relation, fact_id, valid_from) ${placeholders}`).run(...params);
    }

    return entityIds.length;
  });
}

export function getConnectedFacts(entityName: string, limit = 10): number[] {
  const cleaned = entityName.trim();
  if (!cleaned) return [];

  const db = getFactDb();
  const rows = db.prepare(
    `SELECT DISTINCT r.fact_id AS fact_id
     FROM relationships r
     JOIN entities e ON (e.id = r.from_entity OR e.id = r.to_entity)
     WHERE lower(e.name) = lower(?)
       AND r.fact_id IS NOT NULL
       AND r.valid_until IS NULL
     ORDER BY r.id DESC
     LIMIT ?`,
  ).all(cleaned, limit) as Array<{ fact_id: number }>;

  return rows.map((row) => row.fact_id);
}
