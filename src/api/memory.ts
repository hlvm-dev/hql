/**
 * Memory API Object
 *
 * Programmable access to HQL persistent definitions.
 * Usage in REPL:
 *   (memory.list)              ; List all definition names
 *   (memory.get "myFn")        ; Get source of a definition
 *   (memory.remove "myFn")     ; Remove a definition
 *   (memory.clear)             ; Clear all definitions
 *   (memory.stats)             ; Get memory stats
 *   (memory.path)              ; Get memory file path
 */

import {
  getMemoryNames,
  getMemoryStats,
  getDefinitionSource,
  forgetFromMemory,
  clearMemory,
  getMemoryFilePath,
  loadMemory,
  compactMemory,
} from "../cli/repl/memory.ts";

// ============================================================================
// Memory API Object
// ============================================================================

/**
 * Create the memory API object
 * Designed to be registered on globalThis for REPL access
 */
export function createMemoryApi() {
  return {
    /**
     * Load memory definitions from file
     * System-level API - normally called by REPL initialization
     * @example (memory.load evaluator)
     */
    load: async (evaluator: (code: string) => Promise<{ success: boolean; error?: Error }>): Promise<{ docstrings: Map<string, string>; errors: string[] }> => {
      return loadMemory(evaluator);
    },

    /**
     * Compact memory file (remove duplicates/overwritten definitions)
     * System-level API - normally called by REPL initialization
     * @example (memory.compact)
     */
    compact: async (): Promise<void> => {
      await compactMemory();
    },

    /**
     * List all definition names in memory
     * @example (memory.list)
     */
    list: async (): Promise<string[]> => {
      return getMemoryNames();
    },

    /**
     * Get the source code of a definition
     * @example (memory.get "myFn")
     */
    get: async (name: string): Promise<string | null> => {
      if (!name || typeof name !== "string") {
        throw new Error("memory.get requires a name string");
      }
      return getDefinitionSource(name);
    },

    /**
     * Remove a definition from memory
     * @example (memory.remove "myFn")
     */
    remove: async (name: string): Promise<boolean> => {
      if (!name || typeof name !== "string") {
        throw new Error("memory.remove requires a name string");
      }
      return forgetFromMemory(name);
    },

    /**
     * Clear all definitions from memory
     * @example (memory.clear)
     */
    clear: async (): Promise<void> => {
      await clearMemory();
    },

    /**
     * Get memory statistics
     * @example (memory.stats)
     */
    stats: async (): Promise<{ path: string; count: number; size: number } | null> => {
      return getMemoryStats();
    },

    /**
     * Get memory file path
     * @example (memory.path)
     */
    get path(): string {
      return getMemoryFilePath();
    },

    /**
     * Check if a definition exists
     * @example (memory.has "myFn")
     */
    has: async (name: string): Promise<boolean> => {
      if (!name || typeof name !== "string") {
        throw new Error("memory.has requires a name string");
      }
      const source = await getDefinitionSource(name);
      return source !== null;
    },

    /**
     * Get count of definitions
     * @example (memory.count)
     */
    count: async (): Promise<number> => {
      const names = await getMemoryNames();
      return names.length;
    },
  };
}

/**
 * Default memory API instance
 */
export const memory = createMemoryApi();
