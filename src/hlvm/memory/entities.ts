/**
 * Entity and relationship operations for memory graph traversal.
 */

import { getFactDb } from "./db.ts";

export interface ExtractedEntity {
  name: string;
  type: string;
}

const RUNTIMES = new Set(["deno", "node", "bun", "python", "ruby", "go", "rust"]);
const TOOLS = new Set(["redis", "postgres", "postgresql", "mysql", "sqlite", "vitest", "jest", "docker"]);

export function upsertEntity(name: string, type: string): number {
  const cleaned = name.trim();
  if (!cleaned) return 0;

  const db = getFactDb();
  db.prepare("INSERT OR IGNORE INTO entities(name, type) VALUES(?, ?)").run(cleaned, type);
  const row = db.prepare("SELECT id FROM entities WHERE name = ?").value<[number]>(cleaned);
  return row?.[0] ?? 0;
}

export function addRelationship(
  fromEntity: number,
  toEntity: number,
  relation: string,
  factId?: number,
  validFrom?: string,
): number {
  if (!fromEntity || !toEntity || !relation.trim()) return 0;
  const db = getFactDb();
  const vf = validFrom?.trim() || new Date().toISOString().slice(0, 10);
  db.prepare(
    "INSERT INTO relationships(from_entity, to_entity, relation, fact_id, valid_from) VALUES(?, ?, ?, ?, ?)",
  ).run(fromEntity, toEntity, relation, factId ?? null, vf);

  const row = db.prepare("SELECT last_insert_rowid()").value<[number]>();
  return row?.[0] ?? 0;
}

export function extractEntitiesFromText(text: string): ExtractedEntity[] {
  const out = new Map<string, ExtractedEntity>();
  const add = (name: string, type: string) => {
    const cleaned = name.trim();
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (!out.has(key)) out.set(key, { name: cleaned, type });
  };

  const fileMatches = text.match(/\b[\w./-]+\.(?:ts|tsx|js|jsx|json|md|yaml|yml|sql|sh)\b/g) ?? [];
  for (const match of fileMatches) add(match, "file");

  const wordMatches = text.match(/\b[A-Za-z][\w-]{2,}\b/g) ?? [];
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
    if (/^[A-Z][A-Za-z0-9_]+$/.test(word) || /^[a-z]+[A-Z][A-Za-z0-9_]*$/.test(word)) {
      add(word, "concept");
    }
  }

  return [...out.values()];
}

export function linkFactEntities(factId: number, text: string): number {
  const entities = extractEntitiesFromText(text);
  if (entities.length === 0) return 0;

  const db = getFactDb();
  db.exec("BEGIN");
  try {
    const entityIds: number[] = [];
    for (const entity of entities) {
      const entityId = upsertEntity(entity.name, entity.type);
      if (entityId) entityIds.push(entityId);
    }

    // Prepare statement once, reuse for all relationship inserts
    const insertRel = db.prepare(
      "INSERT INTO relationships(from_entity, to_entity, relation, fact_id, valid_from) VALUES(?, ?, ?, ?, ?)",
    );
    const today = new Date().toISOString().slice(0, 10);

    // Link each entity to the fact (self-loop records "entity appears in fact")
    for (const entityId of entityIds) {
      insertRel.run(entityId, entityId, "appears_in", factId, today);
    }

    // Link co-occurring entities to each other
    for (let i = 0; i < entityIds.length; i++) {
      for (let j = i + 1; j < entityIds.length; j++) {
        insertRel.run(entityIds[i], entityIds[j], "co_occurs", factId, today);
      }
    }

    db.exec("COMMIT");
    return entityIds.length;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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

  return rows.map((row) => row.fact_id).filter(Boolean);
}
