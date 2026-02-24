/**
 * Memory System - Barrel Export
 *
 * V2 architecture: SQLite DB is canonical SSOT.
 * Legacy file-based system (search.ts, indexer.ts, store.ts file I/O) removed.
 */

// Utilities
export { sanitizeSensitiveContent, todayDate, warnMemory } from "./store.ts";

// Manager
export { loadMemoryContext } from "./manager.ts";

// Tools
export { MEMORY_TOOLS, setMemoryModelTier } from "./tools.ts";

// Canonical DB
export { getFactDb, closeFactDb } from "./db.ts";
export {
  insertFact,
  invalidateFact,
  invalidateFactsByCategory,
  getValidFacts,
  getFactsByIds,
  searchFactsFts,
  touchFact,
  replaceInFacts,
  type FactRecord,
  type InsertFactOptions,
} from "./facts.ts";
export {
  addRelationship,
  extractEntitiesFromText,
  getConnectedFacts,
  linkFactEntities,
  upsertEntity,
  type ExtractedEntity,
} from "./entities.ts";
export { retrieveMemory, type RetrievalResult } from "./retrieve.ts";
export {
  autoInvalidateConflicts,
  detectConflicts,
  type ConflictCandidate,
  type MemoryModelTier,
} from "./invalidate.ts";
export { extractSessionFacts } from "./extract.ts";
