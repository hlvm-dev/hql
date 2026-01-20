/**
 * Memory API Object
 *
 * Programmable access to HLVM persistent definitions (HQL def/defn).
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
import { ValidationError } from "../../common/error.ts";

export interface MemorySummary {
  count: number;
  names: string[];
  path: string;
  size: number;
}

export interface MemoryApi {
  load: (evaluator: (code: string) => Promise<{ success: boolean; error?: Error }>) => Promise<{
    docstrings: Map<string, string>;
    errors: string[];
  }>;
  compact: () => Promise<void>;
  list: () => Promise<string[]>;
  get: (name: string) => Promise<string | null>;
  remove: (name: string) => Promise<boolean>;
  clear: () => Promise<void>;
  stats: () => Promise<{ path: string; count: number; size: number } | null>;
  readonly path: string;
  has: (name: string) => Promise<boolean>;
  count: () => Promise<number>;
}

export type MemoryCallable = MemoryApi & (() => Promise<MemorySummary>);

// ============================================================================
// Memory API Object
// ============================================================================

/**
 * Create the memory API object
 * Designed to be registered on globalThis for REPL access
 */
function createMemoryApi(): MemoryCallable {
  const api: MemoryApi = {
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
        throw new ValidationError("memory.get requires a name string", "memory.get");
      }
      return getDefinitionSource(name);
    },

    /**
     * Remove a definition from memory
     * @example (memory.remove "myFn")
     */
    remove: async (name: string): Promise<boolean> => {
      if (!name || typeof name !== "string") {
        throw new ValidationError("memory.remove requires a name string", "memory.remove");
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
        throw new ValidationError("memory.has requires a name string", "memory.has");
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

  const memoryFn = async (): Promise<MemorySummary> => {
    const stats = await api.stats();
    const names = await api.list();
    return {
      count: stats?.count ?? names.length,
      names,
      path: stats?.path ?? api.path,
      size: stats?.size ?? 0,
    };
  };

  Object.defineProperties(memoryFn, Object.getOwnPropertyDescriptors(api));
  return memoryFn as MemoryCallable;
}

/**
 * Default memory API instance
 */
export const memory = createMemoryApi();
