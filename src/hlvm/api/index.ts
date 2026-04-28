/**
 * HLVM API Module
 *
 * Central export for all programmable API objects.
 * These are designed to be registered on globalThis for REPL access.
 *
 * Usage in HLVM REPL:
 *   (config.get "model")       // Configuration
 *   (bindings.list)             // Persistent definitions
 *   (memory)                    // Open user HLVM.md in $EDITOR
 *   (history.list)             // Command history
 *   (ai.chat messages)         // AI chat completion
 *   (ai.models.list)           // Model management
 */

// ============================================================================
// Re-exports
// ============================================================================

import { config } from "./config.ts";
import { bindings } from "./bindings.ts";
// `memory` removed — old SQLite-backed API is gone. The `(memory)` REPL
// helper is now a function bound in cli/repl/helpers.ts that opens
// ~/.hlvm/HLVM.md in $EDITOR (CC parity).
import { history, setReplState } from "./history.ts";
import { ai, type AiApi } from "./ai.ts";
import {
  getAbortSignal,
  runtime,
  type RuntimeState,
  setAbortSignal,
  setRuntimeState,
} from "./runtime.ts";
import { log } from "./log.ts";
import { errors } from "./errors.ts";
import type { HistoryEntryMetadata } from "../cli/repl/history-storage.ts";

/** Top-level alias for ai.agent — runs the ReAct agent loop */
export const agent: AiApi["agent"] = ai.agent;

export const REGISTERED_API_GLOBAL_NAMES = [
  "config",
  "bindings",
  "memory",
  "history",
  "ai",
  "agent",
  "runtime",
  "log",
  "errors",
] as const;

export {
  ai,
  config,
  errors,
  getAbortSignal,
  history,
  log,
  bindings,
  runtime,
  setAbortSignal,
  setReplState,
  setRuntimeState,
};

/**
 * Options for registering APIs on globalThis
 */
interface RegisterApisOptions {
  /** REPL state for history API */
  replState?: {
    history: string[];
    addHistory(input: string, metadata?: HistoryEntryMetadata): void;
    flushHistory(): Promise<void>;
    clearHistory(): Promise<void>;
  };
  /** Runtime hooks for transient REPL state */
  runtime?: RuntimeState;
}

/**
 * Register all API objects on globalThis for REPL access
 * Call this during REPL initialization
 */
export function registerApis(options?: RegisterApisOptions): void {
  // Set up references
  if (options?.replState) {
    setReplState(options.replState);
  }
  if (options?.runtime) {
    setRuntimeState(options.runtime);
  }

  // Register on globalThis
  const global = globalThis as Record<string, unknown>;
  global.config = config;
  global.bindings = bindings;
  // `memory` global is bound by cli/repl/helpers.ts to a function that
  // opens ~/.hlvm/HLVM.md in $EDITOR (CC `/memory` parity at REPL level).
  global.history = history;
  global.ai = ai;
  global.agent = agent;
  global.runtime = runtime;
  global.log = log;
  global.errors = errors;
}
