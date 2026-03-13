/**
 * Fact operations over the canonical memory DB.
 */

import { getFactDb } from "./db.ts";
import { sanitizeSensitiveContent, todayDate, warnMemory } from "./store.ts";
import { ValidationError } from "../../common/error.ts";

export interface FactRecord {
  id: number;
  content: string;
  category: string;
  source: string;
  validFrom: string;
  validUntil: string | null;
  createdAt: number;
  accessedAt: number | null;
  accessCount: number;
  embedding?: Uint8Array;
  embeddingModel?: string | null;
}

export interface InsertFactOptions {
  content: string;
  category?: string;
  source?: string;
  validFrom?: string;
  embedding?: Uint8Array;
  embeddingModel?: string;
}

type RawFactRow = {
  id: number;
  content: string;
  category: string;
  source: string;
  valid_from: string;
  valid_until: string | null;
  created_at: number;
  accessed_at: number | null;
  access_count: number;
  embedding?: Uint8Array;
  embedding_model?: string | null;
};

/** Run `fn` inside a BEGIN/COMMIT transaction; ROLLBACK on throw. */
export function withTransaction<T>(fn: () => T): T {
  const db = getFactDb();
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Delete a row from the FTS5 index. */
function deleteFtsRow(rowId: number, content: string): void {
  getFactDb().prepare(
    "INSERT INTO facts_fts(facts_fts, rowid, content) VALUES('delete', ?, ?)",
  ).run(rowId, content);
}

function queryWords(query: string): string[] {
  return query
    .replace(/['"*():^{}|]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w && w.length <= 100 && !/^(AND|OR|NOT|NEAR)$/i.test(w));
}

function parseFactRow(row: RawFactRow): FactRecord {
  return {
    id: row.id,
    content: row.content,
    category: row.category,
    source: row.source,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    createdAt: row.created_at,
    accessedAt: row.accessed_at,
    accessCount: row.access_count,
    embedding: row.embedding,
    embeddingModel: row.embedding_model ?? null,
  };
}

export function insertFact(opts: InsertFactOptions): number {
  const category = opts.category?.trim() || "General";
  const source = opts.source?.trim() || "memory";
  const validFrom = opts.validFrom?.trim() || todayDate();
  const { sanitized, stripped } = sanitizeSensitiveContent(opts.content ?? "");
  const content = sanitized.trim();

  if (!content) {
    throw new ValidationError("Fact content is required", "memory_write");
  }

  if (stripped.length > 0) {
    void warnMemory(
      `Memory: stripped sensitive content from fact (${stripped.join(", ")})`,
    );
  }

  return withTransaction(() => {
    const db = getFactDb();
    db.prepare(
      "INSERT INTO facts (content, category, source, embedding, embedding_model, valid_from) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      content,
      category,
      source,
      opts.embedding ?? null,
      opts.embeddingModel ?? null,
      validFrom,
    );

    const row = db.prepare("SELECT last_insert_rowid()").value<[number]>();
    const factId = row?.[0] ?? 0;
    if (!factId) {
      throw new ValidationError("Failed to insert fact", "memory_write");
    }

    db.prepare("INSERT INTO facts_fts (rowid, content) VALUES (?, ?)").run(
      factId,
      content,
    );
    return factId;
  });
}

export function invalidateFact(factId: number): void {
  const db = getFactDb();
  const row = db.prepare(
    "SELECT content FROM facts WHERE id = ? AND valid_until IS NULL",
  ).value<[string]>(factId);
  if (!row) return;
  const today = todayDate();
  db.prepare(
    "UPDATE facts SET valid_until = ? WHERE id = ?",
  ).run(today, factId);
  deleteFtsRow(factId, row[0]);
  db.prepare(
    "UPDATE relationships SET valid_until = ? WHERE valid_until IS NULL AND fact_id = ?",
  ).run(today, factId);
}

export function invalidateFactsByCategory(category: string): number {
  const db = getFactDb();
  const rows = db.prepare(
    "SELECT id, content FROM facts WHERE category = ? AND valid_until IS NULL",
  ).all(category.trim()) as Array<{ id: number; content: string }>;
  if (rows.length === 0) return 0;
  const today = todayDate();
  return withTransaction(() => {
    const factIds = rows.map((r) => r.id);
    const placeholders = factIds.map(() => "?").join(",");
    db.prepare(
      `UPDATE facts SET valid_until = ? WHERE id IN (${placeholders})`,
    ).run(today, ...factIds);
    for (const row of rows) deleteFtsRow(row.id, row.content);
    db.prepare(
      `UPDATE relationships SET valid_until = ? WHERE valid_until IS NULL AND fact_id IN (${placeholders})`,
    ).run(today, ...factIds);
    return rows.length;
  });
}

export function invalidateAllFacts(): number {
  const db = getFactDb();
  const rows = db.prepare(
    "SELECT id, content FROM facts WHERE valid_until IS NULL",
  ).all() as Array<{ id: number; content: string }>;
  if (rows.length === 0) return 0;
  const today = todayDate();
  return withTransaction(() => {
    db.prepare(
      "UPDATE facts SET valid_until = ? WHERE valid_until IS NULL",
    ).run(today);
    for (const row of rows) deleteFtsRow(row.id, row.content);
    db.prepare(
      "UPDATE relationships SET valid_until = ? WHERE valid_until IS NULL AND fact_id IN (SELECT id FROM facts WHERE valid_until = ?)",
    ).run(today, today);
    return rows.length;
  });
}

export function getValidFacts(
  options?: { category?: string; limit?: number },
): FactRecord[] {
  const db = getFactDb();
  const limit = options?.limit && options.limit > 0 ? options.limit : 200;
  const category = options?.category?.trim();
  const whereClause = category
    ? "WHERE valid_until IS NULL AND category = ?"
    : "WHERE valid_until IS NULL";
  const params = category ? [category, limit] : [limit];

  const rows = db.prepare(
    `SELECT id, content, category, source, valid_from, valid_until, created_at, accessed_at, access_count, embedding, embedding_model
     FROM facts
     ${whereClause}
     ORDER BY access_count DESC, created_at DESC, id DESC
     LIMIT ?`,
  ).all(...params);

  return (rows as RawFactRow[]).map(parseFactRow);
}

export function getFactsByIds(ids: number[]): FactRecord[] {
  if (ids.length === 0) return [];
  const db = getFactDb();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT id, content, category, source, valid_from, valid_until, created_at, accessed_at, access_count, embedding, embedding_model
     FROM facts
     WHERE valid_until IS NULL AND id IN (${placeholders})`,
  ).all(...ids);

  return (rows as RawFactRow[]).map(parseFactRow);
}

export function touchFact(factId: number): void {
  const db = getFactDb();
  db.prepare(
    "UPDATE facts SET accessed_at = unixepoch(), access_count = access_count + 1 WHERE id = ?",
  ).run(factId);
}

export function replaceInFacts(findText: string, replaceWith: string): number {
  const db = getFactDb();
  const { sanitized } = sanitizeSensitiveContent(replaceWith);

  return withTransaction(() => {
    const rows = db.prepare(
      `SELECT id, content FROM facts
       WHERE valid_until IS NULL AND instr(content, ?) > 0`,
    ).all(findText) as Array<{ id: number; content: string }>;

    if (rows.length === 0) return 0;

    for (const row of rows) {
      const newContent = row.content.replaceAll(findText, sanitized);
      db.prepare("UPDATE facts SET content = ? WHERE id = ?").run(
        newContent,
        row.id,
      );
      deleteFtsRow(row.id, row.content);
      db.prepare("INSERT INTO facts_fts(rowid, content) VALUES(?, ?)").run(
        row.id,
        newContent,
      );
    }
    return rows.length;
  });
}

export function searchFactsFts(
  query: string,
  limit = 5,
): Array<FactRecord & { bm25Score: number }> {
  const db = getFactDb();
  const words = queryWords(query.trim());
  if (words.length === 0) return [];

  const andExpr = words.map((w) => `"${w}"`).join(" ");
  const orExpr = words.map((w) => `"${w}"`).join(" OR ");

  const stmt = db.prepare(
    `SELECT f.id, f.content, f.category, f.source, f.valid_from, f.valid_until,
            f.created_at, f.accessed_at, f.access_count, f.embedding, f.embedding_model,
            abs(rank) AS bm25_score
     FROM facts_fts
     JOIN facts f ON f.id = facts_fts.rowid
     WHERE facts_fts MATCH ? AND f.valid_until IS NULL
     ORDER BY rank
     LIMIT ?`,
  );

  type FtsRow = RawFactRow & { bm25_score: number };

  let rows = stmt.all(andExpr, limit * 4) as FtsRow[];

  if (rows.length === 0 && words.length > 1) {
    rows = stmt.all(orExpr, limit * 4) as FtsRow[];
  }

  return rows.map((row) => ({
    ...parseFactRow(row),
    bm25Score: row.bm25_score,
  })).slice(0, limit);
}
