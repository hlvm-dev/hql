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

const STDLIB_IMPORT_PATH = "embedded:stdlib/index.js";

interface ModuleLoaderOptions {
  state: ReplState;
  suppressErrors?: boolean;
}

export interface ModuleLoaderResult {
  stdlibExports: string[];
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
 * 2. Registers functions on globalThis (for JS evaluation)
 * 3. Registers with ReplState (for tab completion, signatures)
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
    errors: [],
  };

  // Load stdlib/index.js (general functions)
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

  return result;
}
