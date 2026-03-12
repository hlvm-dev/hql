/**
 * Memory System - Barrel Export
 *
 * V2 architecture: SQLite DB is canonical SSOT.
 * Legacy file-based system (search.ts, indexer.ts, store.ts file I/O) removed.
 */

// Manager
export { buildMemorySystemMessage, loadMemoryContext } from "./manager.ts";

// Tools
export { MEMORY_TOOLS, setMemoryModelTier } from "./tools.ts";

// Shared write pipeline
export { insertFact } from "./pipeline.ts";

// Canonical DB — exports used by tests and external consumers
export { closeFactDb, getFactDb } from "./db.ts";
export {
  getValidFacts,
  invalidateFact,
  searchFactsFts,
  touchFact,
} from "./facts.ts";
export { linkFactEntities } from "./entities.ts";
export {
  extractConversationFacts,
  extractSessionFacts,
  parseLLMExtractionResponse,
  persistConversationFacts,
} from "./extract.ts";
