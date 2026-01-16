/**
 * HQL API Module
 *
 * Central export for all programmable API objects.
 * These are designed to be registered on globalThis for REPL access.
 *
 * Usage in HQL REPL:
 *   (config.get "model")       ; Configuration
 *   (memory.list)              ; Persistent definitions
 *   (session.list)             ; Chat sessions
 *   (history.list)             ; Command history
 *   (ai.generate "prompt")     ; AI capabilities
 *   (ai.models.list)           ; Model management
 */

// ============================================================================
// Re-exports
// ============================================================================

// Config API
export { config, createConfigApi } from "./config.ts";

// Memory API
export { memory, createMemoryApi } from "./memory.ts";

// Session API
export { session, createSessionApi, setSessionManager } from "./session.ts";

// History API
export { history, createHistoryApi, setReplState } from "./history.ts";

// AI API
export { ai, createAiApi } from "./ai.ts";

// Runtime API
export { runtime, createRuntimeApi, setRuntimeState, setAbortSignal, getAbortSignal } from "./runtime.ts";

// ============================================================================
// Initialization Helper
// ============================================================================

import { config } from "./config.ts";
import { memory } from "./memory.ts";
import { session, setSessionManager } from "./session.ts";
import { history, setReplState } from "./history.ts";
import { ai } from "./ai.ts";
import { runtime, setRuntimeState, type RuntimeState } from "./runtime.ts";

/**
 * Options for registering APIs on globalThis
 */
interface RegisterApisOptions {
  /** Session manager for session API */
  // deno-lint-ignore no-explicit-any
  sessionManager?: any;
  /** REPL state for history API */
  replState?: {
    history: string[];
    addHistory(input: string): void;
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
  if (options?.sessionManager) {
    setSessionManager(options.sessionManager);
  }
  if (options?.replState) {
    setReplState(options.replState);
  }
  if (options?.runtime) {
    setRuntimeState(options.runtime);
  }

  // Register on globalThis
  const global = globalThis as Record<string, unknown>;
  global.config = config;
  global.memory = memory;
  global.session = session;
  global.history = history;
  global.ai = ai;
  global.runtime = runtime;
}

/**
 * All API objects as a single bundle
 */
export const apis = {
  config,
  memory,
  session,
  history,
  ai,
  runtime,
};
