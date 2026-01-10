/**
 * HQL REPL Session Module
 * Public API for session persistence and management
 *
 * Usage:
 * ```typescript
 * import { SessionManager } from "./session/index.ts";
 * const manager = new SessionManager(Deno.cwd());
 * await manager.initialize();
 * await manager.recordMessage("user", "(+ 1 2)");
 * ```
 */

// Public types - what consumers need to work with SessionManager
export type {
  SessionMeta,
  SessionMessage,
  Session,
  SessionInitOptions,
} from "./types.ts";

// Session Manager - the main public API
export { SessionManager } from "./manager.ts";
