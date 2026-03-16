/**
 * Memory API Object
 *
 * Programmable access to assistant-visible durable memory.
 * Usage in REPL:
 *   (memory)                    // View explicit notes + durable facts
 *   (memory.get)                // Same as (memory)
 *   (memory.search "deno")      // Search memory
 *   (memory.add "Use tabs" "Preferences")
 *   (memory.appendNote "Personal note")
 *   (memory.replace "old" "new")
 *   (memory.clear true)         // Clear notes + facts
 */

import { getMemoryDbPath, getMemoryMdPath } from "../../common/paths.ts";
import { ValidationError } from "../../common/error.ts";
import {
  appendExplicitMemoryNote,
  clearExplicitMemory,
  getValidFacts,
  insertFact,
  replaceExplicitMemoryText,
  replaceInFacts,
  retrieveMemory,
  type RetrievalResult,
  readExplicitMemory,
  invalidateAllFacts,
} from "../memory/mod.ts";
import { assertString } from "./validation.ts";

interface MemoryFactView {
  id: number;
  category: string;
  content: string;
  source: string;
  validFrom: string;
}

interface MemorySnapshot {
  notesPath: string;
  dbPath: string;
  notes: string;
  factCount: number;
  facts: MemoryFactView[];
}

interface MemorySearchResult extends RetrievalResult {
  kind: "fact" | "note";
  path?: string;
}

interface MemoryApi {
  get: () => Promise<MemorySnapshot>;
  search: (query: string, limit?: number) => Promise<MemorySearchResult[]>;
  add: (text: string, category?: string) => Promise<{
    factId: number;
    category: string;
  }>;
  appendNote: (text: string) => Promise<{ path: string }>;
  replace: (findText: string, replaceWith: string) => Promise<{
    noteReplacements: number;
    factReplacements: number;
  }>;
  clear: (confirm?: boolean) => Promise<{
    clearedNotes: boolean;
    clearedFacts: number;
  }>;
  readonly notesPath: string;
  readonly dbPath: string;
}

type MemoryCallable = MemoryApi & (() => Promise<MemorySnapshot>);

function buildMemorySnapshot(
  notes: string,
): MemorySnapshot {
  const facts = getValidFacts().map((fact) => ({
    id: fact.id,
    category: fact.category,
    content: fact.content,
    source: fact.source,
    validFrom: fact.validFrom,
  }));
  return {
    notesPath: getMemoryMdPath(),
    dbPath: getMemoryDbPath(),
    notes,
    factCount: facts.length,
    facts,
  };
}

function searchNotes(
  notes: string,
  query: string,
  limit: number,
): MemorySearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const hits: MemorySearchResult[] = [];
  const notesPath = getMemoryMdPath();
  const lines = notes.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.toLowerCase().includes(normalizedQuery)) continue;
    hits.push({
      kind: "note",
      text: line,
      file: "memory/notes",
      path: notesPath,
      date: "",
      score: 1,
      source: "notes",
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

function createMemoryApi(): MemoryCallable {
  const api: MemoryApi = {
    get: async (): Promise<MemorySnapshot> => {
      return buildMemorySnapshot(await readExplicitMemory());
    },

    search: async (
      query: string,
      limit = 5,
    ): Promise<MemorySearchResult[]> => {
      assertString(query, "memory.search", "memory.search requires a query string");
      const trimmed = query.trim();
      if (!trimmed) return [];
      const maxResults = limit > 0 ? limit : 5;
      const notes = await readExplicitMemory();
      const noteHits = searchNotes(notes, trimmed, maxResults);
      const factHits = retrieveMemory(trimmed, maxResults).map((result) => ({
        ...result,
        kind: "fact" as const,
      }));
      return [...noteHits, ...factHits].slice(0, maxResults);
    },

    add: async (
      text: string,
      category?: string,
    ): Promise<{ factId: number; category: string }> => {
      assertString(text, "memory.add", "memory.add requires a non-empty text string");
      const trimmed = text.trim();
      if (!trimmed) {
        throw new ValidationError(
          "memory.add requires a non-empty text string",
          "memory.add",
        );
      }
      const normalizedCategory = category?.trim() || "General";
      return {
        factId: insertFact({
          content: trimmed,
          category: normalizedCategory,
          source: "memory",
        }),
        category: normalizedCategory,
      };
    },

    appendNote: async (text: string): Promise<{ path: string }> => {
      assertString(text, "memory.appendNote", "memory.appendNote requires a non-empty text string");
      const trimmed = text.trim();
      if (!trimmed) {
        throw new ValidationError(
          "memory.appendNote requires a non-empty text string",
          "memory.appendNote",
        );
      }
      await appendExplicitMemoryNote(trimmed);
      return { path: getMemoryMdPath() };
    },

    replace: async (
      findText: string,
      replaceWith: string,
    ): Promise<{ noteReplacements: number; factReplacements: number }> => {
      assertString(
        findText,
        "memory.replace",
        "memory.replace requires a find string",
      );
      if (typeof replaceWith !== "string") {
        throw new ValidationError(
          "memory.replace requires a replacement string",
          "memory.replace",
        );
      }
      const noteReplacements = await replaceExplicitMemoryText(findText, replaceWith);
      const factReplacements = replaceInFacts(findText, replaceWith);
      return { noteReplacements, factReplacements };
    },

    clear: async (
      confirm = false,
    ): Promise<{ clearedNotes: boolean; clearedFacts: number }> => {
      if (confirm !== true) {
        throw new ValidationError(
          "memory.clear requires confirm=true",
          "memory.clear",
        );
      }
      const clearedFacts = invalidateAllFacts();
      await clearExplicitMemory();
      return {
        clearedNotes: true,
        clearedFacts,
      };
    },

    get notesPath(): string {
      return getMemoryMdPath();
    },

    get dbPath(): string {
      return getMemoryDbPath();
    },
  };

  const memoryFn = async (): Promise<MemorySnapshot> => {
    return await api.get();
  };

  Object.defineProperties(memoryFn, Object.getOwnPropertyDescriptors(api));
  return memoryFn as MemoryCallable;
}

export const memory = createMemoryApi();
