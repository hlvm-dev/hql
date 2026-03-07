/**
 * HLVM API Module
 *
 * Central export for all programmable API objects.
 * These are designed to be registered on globalThis for REPL access.
 *
 * Usage in HLVM REPL:
 *   (config.get "model")       // Configuration
 *   (memory.list)              // Persistent definitions
 *   (session.list)             // Chat sessions
 *   (history.list)             // Command history
 *   (ai.generate "prompt")     // AI capabilities
 *   (ai.models.list)           // Model management
 */

// ============================================================================
// Re-exports
// ============================================================================

import { config } from "./config.ts";
import { memory } from "./memory.ts";
import {
  session,
  type SessionManagerRef,
  setSessionManager,
} from "./session.ts";
import { history, setReplState } from "./history.ts";
import { ai } from "./ai.ts";
import {
  getAbortSignal,
  runtime,
  type RuntimeState,
  setAbortSignal,
  setRuntimeState,
} from "./runtime.ts";
import { log } from "./log.ts";
import { errors } from "./errors.ts";

export {
  ai,
  config,
  errors,
  getAbortSignal,
  history,
  log,
  memory,
  runtime,
  session,
  type SessionManagerRef,
  setAbortSignal,
  setReplState,
  setRuntimeState,
  setSessionManager,
};

/**
 * Options for registering APIs on globalThis
 */
interface RegisterApisOptions {
  /** Deprecated compatibility hook for legacy eval-session bootstrapping */
  sessionManager?: SessionManagerRef;
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
  global.log = log;
  global.errors = errors;
}
