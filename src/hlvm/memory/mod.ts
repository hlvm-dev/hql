/**
 * Memory System - Barrel Export
 *
 * Central re-export for the memory module.
 */

// Store operations
export {
  appendToJournal,
  appendToMemoryMd,
  readMemoryMd,
  readRecentJournals,
  removeSectionFromMemoryMd,
  replaceInMemoryMd,
  writeMemoryMd,
} from "./store.ts";

// Manager
export { loadMemoryContext, resetMemoryStateForTesting } from "./manager.ts";

// Tools
export { MEMORY_TOOLS } from "./tools.ts";

// Search
export { closeMemoryDb, getIndexedFiles, optimizeFts, removeFileMeta, searchMemory } from "./search.ts";

// Indexer
export { indexFile, reindexMemoryFiles } from "./indexer.ts";
