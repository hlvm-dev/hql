/**
 * Memory System - Barrel Export
 *
 * Central re-export for the memory module.
 */

// Store operations
export {
  appendToJournal,
  appendToMemoryMd,
  readJournal,
  readMemoryMd,
  readRecentJournals,
  sanitizeSensitiveContent,
  writeMemoryMd,
} from "./store.ts";

// Manager
export { loadMemoryContext, resetMigrationForTesting } from "./manager.ts";

// Tools
export { MEMORY_TOOLS } from "./tools.ts";

// Search
export { closeMemoryDb, searchMemory } from "./search.ts";

// Indexer
export { reindexMemoryFiles } from "./indexer.ts";
