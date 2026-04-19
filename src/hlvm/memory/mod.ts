/**
 * Memory System - Barrel Export
 *
 * Canonical prompt assembly is centralized in manager.ts.
 * Sources: explicit MEMORY.md + auto-learned SQLite memory.
 */

// Manager
export {
  buildMemorySystemMessage,
  isMemorySystemMessage,
  loadMemoryContext,
  loadMemorySystemMessage,
} from "./manager.ts";
export { isPersistentMemoryEnabled } from "./policy.ts";
export {
  persistConversationFacts,
  persistExplicitMemoryRequest,
} from "./extract.ts";
export {
  buildRelevantMemoryRecall,
  type RelevantMemoryRecall,
} from "./recall.ts";

// Tools
export {
  _resetMemoryModelCapabilityForTests,
  MEMORY_TOOLS,
  setMemoryModelCapability,
} from "./tools.ts";

// Shared write pipeline
export { insertFact } from "./pipeline.ts";

// Canonical DB — exports used by tests and external consumers
export { closeFactDb, getFactDb } from "./db.ts";
export {
  countValidFacts,
  getValidFacts,
  invalidateAllFacts,
  invalidateFact,
  replaceInFacts,
  searchFactsFts,
  touchFact,
} from "./facts.ts";
export { linkFactEntities } from "./entities.ts";
export {
  accessBoost,
  type RetrievalResult,
  retrieveMemory,
  temporalDecay,
} from "./retrieve.ts";

// Explicit memory (user-facing MEMORY.md)
export {
  appendExplicitMemoryNote,
  clearExplicitMemory,
  getExplicitMemoryPath,
  readExplicitMemory,
  replaceExplicitMemoryText,
  writeExplicitMemory,
} from "./explicit.ts";

// Shared utilities
export { sanitizeSensitiveContent } from "./store.ts";
