/**
 * Bindings API Object
 *
 * Programmable access to HLVM persistent definitions (HQL def/defn).
 * Usage in REPL:
 *   (bindings.list)              // List all definition names
 *   (bindings.get "myFn")        // Get source of a definition
 *   (bindings.remove "myFn")     // Remove a definition
 *   (bindings.clear)             // Clear all definitions
 *   (bindings.stats)             // Get bindings stats
 *   (bindings.path)              // Get bindings file path
 */

import {
  clearBindings,
  compactBindings,
  removeBinding,
  getDefinitionSource,
  getBindingsFilePath,
  getBindingNames,
  getBindingStats,
  loadBindings,
} from "../cli/repl/bindings.ts";
import { ValidationError } from "../../common/error.ts";

function assertString(
  value: unknown,
  context: string,
  message: string,
): asserts value is string {
  if (!value || typeof value !== "string") {
    throw new ValidationError(message, context);
  }
}

interface BindingsSummary {
  count: number;
  names: string[];
  path: string;
  size: number;
}

export interface BindingsApi {
  load: (
    evaluator: (code: string) => Promise<{ success: boolean; error?: Error }>,
  ) => Promise<{
    docstrings: Map<string, string>;
    errors: string[];
  }>;
  compact: () => Promise<{ before: number; after: number }>;
  list: () => Promise<string[]>;
  get: (name: string) => Promise<string | null>;
  remove: (name: string) => Promise<boolean>;
  clear: () => Promise<void>;
  stats: () => Promise<{ path: string; count: number; size: number } | null>;
  readonly path: string;
  has: (name: string) => Promise<boolean>;
  count: () => Promise<number>;
}

type BindingsCallable = BindingsApi & (() => Promise<BindingsSummary>);

// ============================================================================
// Bindings API Object
// ============================================================================

/**
 * Create the bindings API object
 * Designed to be registered on globalThis for REPL access
 */
function createBindingsApi(): BindingsCallable {
  const api: BindingsApi = {
    /**
     * Load binding definitions from file
     * System-level API - normally called by REPL initialization
     * @example (bindings.load evaluator)
     */
    load: (
      evaluator: (code: string) => Promise<{ success: boolean; error?: Error }>,
    ): Promise<{ docstrings: Map<string, string>; errors: string[] }> => {
      return loadBindings(evaluator);
    },

    /**
     * Compact bindings file (remove duplicates/overwritten definitions)
     * System-level API - normally called by REPL initialization
     * @example (bindings.compact)
     */
    compact: (): Promise<{ before: number; after: number }> => {
      return compactBindings();
    },

    /**
     * List all definition names in bindings
     * @example (bindings.list)
     */
    list: (): Promise<string[]> => {
      return getBindingNames();
    },

    /**
     * Get the source code of a definition
     * @example (bindings.get "myFn")
     */
    get: (name: string): Promise<string | null> => {
      assertString(name, "bindings.get", "bindings.get requires a name string");
      return getDefinitionSource(name);
    },

    /**
     * Remove a definition from bindings
     * @example (bindings.remove "myFn")
     */
    remove: (name: string): Promise<boolean> => {
      assertString(
        name,
        "bindings.remove",
        "bindings.remove requires a name string",
      );
      return removeBinding(name);
    },

    /**
     * Clear all definitions from bindings
     * @example (bindings.clear)
     */
    clear: (): Promise<void> => {
      return clearBindings();
    },

    /**
     * Get bindings statistics
     * @example (bindings.stats)
     */
    stats: (): Promise<
      { path: string; count: number; size: number } | null
    > => {
      return getBindingStats();
    },

    /**
     * Get bindings file path
     * @example (bindings.path)
     */
    get path(): string {
      return getBindingsFilePath();
    },

    /**
     * Check if a definition exists
     * @example (bindings.has "myFn")
     */
    has: async (name: string): Promise<boolean> => {
      assertString(name, "bindings.has", "bindings.has requires a name string");
      const source = await getDefinitionSource(name);
      return source !== null;
    },

    /**
     * Get count of definitions
     * @example (bindings.count)
     */
    count: async (): Promise<number> => {
      const names = await getBindingNames();
      return names.length;
    },
  };

  const bindingsFn = async (): Promise<BindingsSummary> => {
    const [stats, names] = await Promise.all([api.stats(), api.list()]);
    return {
      count: stats?.count ?? names.length,
      names,
      path: stats?.path ?? api.path,
      size: stats?.size ?? 0,
    };
  };

  Object.defineProperties(bindingsFn, Object.getOwnPropertyDescriptors(api));
  return bindingsFn as BindingsCallable;
}

/**
 * Default bindings API instance
 */
export const bindings = createBindingsApi();
