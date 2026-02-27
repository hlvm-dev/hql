/**
 * Memory System - Barrel Export
 *
 * V2 architecture: SQLite DB is canonical SSOT.
 * Legacy file-based system (search.ts, indexer.ts, store.ts file I/O) removed.
 */

// Manager
export { loadMemoryContext } from "./manager.ts";

// Tools
export { MEMORY_TOOLS, setMemoryModelTier } from "./tools.ts";

// Canonical DB — exports used by tests and external consumers
export { getFactDb, closeFactDb } from "./db.ts";
export {
  insertFact,
  invalidateFact,
  getValidFacts,
  searchFactsFts,
  touchFact,
} from "./facts.ts";
export { linkFactEntities } from "./entities.ts";
export { extractSessionFacts } from "./extract.ts";
