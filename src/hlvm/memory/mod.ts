/**
 * Memory System - Barrel Export
 *
 * Canonical prompt assembly is centralized in manager.ts.
 * Sources: explicit MEMORY.md + auto-learned SQLite memory.
 */

// Manager
export {
  isMemorySystemMessage,
  loadMemorySystemMessage,
} from "./manager.ts";
export { isPersistentMemoryEnabled } from "./policy.ts";

// Tools
export { MEMORY_TOOLS, setMemoryModelTier } from "./tools.ts";

// Shared write pipeline
export { insertFact } from "./pipeline.ts";

// Canonical DB — exports used by tests and external consumers
export { closeFactDb, getFactDb } from "./db.ts";
export {
  getValidFacts,
  invalidateAllFacts,
  invalidateFact,
  replaceInFacts,
  searchFactsFts,
  touchFact,
} from "./facts.ts";
export { linkFactEntities } from "./entities.ts";
export { retrieveMemory, type RetrievalResult } from "./retrieve.ts";
export {
  extractConversationFacts,
  extractSessionFacts,
  parseLLMExtractionResponse,
  persistConversationFacts,
} from "./extract.ts";

// Explicit memory (user-facing MEMORY.md)
export {
  readExplicitMemory,
  appendExplicitMemoryNote,
  clearExplicitMemory,
  getExplicitMemoryPath,
  replaceExplicitMemoryText,
  writeExplicitMemory,
} from "./explicit.ts";
