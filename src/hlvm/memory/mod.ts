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

// Shared write pipeline
export { insertFact, writeMemoryFact, writeMemoryFacts } from "./pipeline.ts";

// Canonical DB — exports used by tests and external consumers
export { closeFactDb, getFactDb } from "./db.ts";
export {
  getValidFacts,
  insertFact as insertFactRaw,
  invalidateFact,
  searchFactsFts,
  touchFact,
} from "./facts.ts";
export { linkFactEntities } from "./entities.ts";
export {
  extractAndPersistBaselineFactsFromMessages,
  extractAndPersistBaselineFactsFromText,
  extractBaselineFactsFromMessages,
  extractBaselineFactsFromText,
  extractConversationFacts,
  extractSessionFacts,
  persistConversationFacts,
} from "./extract.ts";
