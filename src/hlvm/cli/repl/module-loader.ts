/**
 * Module Loader - SSOT for stdlib module loading
 * Used by both Ink REPL and HTTP REPL to ensure feature parity
 *
 * CRITICAL: This is the single source of truth for module loading.
 * Both REPL interfaces MUST use this to prevent drift.
 */

import type { ReplState } from "./state.ts";
import { log } from "../../api/log.ts";
import { ImportError } from "../../../common/error.ts";
import { ensureError } from "../../../common/utils.ts";
import * as StdlibModule from "../../../hql/lib/stdlib/js/index.js";
import * as AiModule from "../../../hql/lib/stdlib/js/ai.js";

const STDLIB_IMPORT_PATH = "embedded:stdlib/index.js";
const AI_IMPORT_PATH = "embedded:stdlib/ai.js";

interface ModuleLoaderOptions {
  state: ReplState;
  suppressErrors?: boolean;
}

export interface ModuleLoaderResult {
  stdlibExports: string[];
  aiExports: string[];
  errors: string[];
}

function handleModuleLoadError(
  result: ModuleLoaderResult,
  moduleLabel: string,
  importPath: string,
  error: unknown,
  suppressErrors: boolean,
): void {
  const err = ensureError(error);
  const msg = `Failed to load ${moduleLabel}: ${err.message}`;
  log.error(msg, err);
  const importError = new ImportError(msg, importPath, err);
  if (!suppressErrors) {
    throw importError;
  }
  result.errors.push(msg);
}

/**
 * Load stdlib modules and register with REPL state
 *
 * This function:
 * 1. Loads stdlib/index.js (general functions: map, filter, etc.)
 * 2. Loads stdlib/ai.js (AI functions: ask, generate, chat, example)
 * 3. Registers functions on globalThis (for JS evaluation)
 * 4. Registers with ReplState (for tab completion, signatures)
 *
 * @param options - Configuration including ReplState
 * @returns Result with loaded exports and any errors
 */
export async function loadStdlibModules(
  options: ModuleLoaderOptions,
): Promise<ModuleLoaderResult> {
  const { state, suppressErrors = true } = options;
  const result: ModuleLoaderResult = {
    stdlibExports: [],
    aiExports: [],
    errors: [],
  };

  // Phase 1: Load stdlib/index.js (general functions)
  try {
    for (const [name, value] of Object.entries(StdlibModule)) {
      if (typeof value === "function" && !name.startsWith("_")) {
        state.addJsFunction(name, value as (...args: unknown[]) => unknown);
        result.stdlibExports.push(name);
      }
    }

    log.debug(`Loaded ${result.stdlibExports.length} stdlib functions`);
  } catch (error) {
    handleModuleLoadError(result, "stdlib", STDLIB_IMPORT_PATH, error, suppressErrors);
  }

  // Phase 2: Load stdlib/ai.js (AI functions)
  try {
    const exportedNames: string[] = [];

    // Extract all exports (skip internal helpers starting with _)
    for (const name of Object.keys(AiModule)) {
      if (name.startsWith("_") || name === "default") continue;
      exportedNames.push(name);
    }

    // Register on globalThis and with ReplState
    const globalAny = globalThis as Record<string, unknown>;

    for (const name of exportedNames) {
      const value = (AiModule as Record<string, unknown>)[name];

      // Set on globalThis (makes available in JS evaluation context)
      globalAny[name] = value;

      // Register with state (skip if already bound to avoid conflicts)
      if (!state.hasBinding(name)) {
        if (typeof value === "function") {
          state.addJsFunction(name, value as (...args: unknown[]) => unknown);
          result.aiExports.push(name);
        } else {
          // Non-function exports (e.g., FormatType constant)
          state.addBinding(name);
        }
      }
    }

    // Phase 3: No extra HQL bindings needed.
    // REPL evaluation resolves globalThis properties in the eval context, so
    // (typeof ask) and direct calls work once globalThis is populated.

    log.debug(`Loaded ${result.aiExports.length} AI functions: ${result.aiExports.join(", ")}`);
  } catch (error) {
    handleModuleLoadError(result, "AI module", AI_IMPORT_PATH, error, suppressErrors);
  }

  return result;
}
