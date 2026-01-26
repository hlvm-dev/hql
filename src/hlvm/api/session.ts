/**
 * Session API Object
 *
 * Programmable access to HLVM chat sessions (global).
 * Usage in REPL:
 *   (session.list)                  ; List all sessions
 *   (session.get "id")              ; Load a specific session
 *   (session.current)               ; Get current session info
 *   (session.remove "id")           ; Delete a session
 */

import {
  listSessions,
  loadSession,
  deleteSession,
  exportSession,
} from "../cli/repl/session/storage.ts";

import type { SessionMeta, Session } from "../cli/repl/session/types.ts";
import { getSessionsDir } from "../../common/paths.ts";
import { ValidationError } from "../../common/error.ts";
import { assertString } from "./validation.ts";

// ============================================================================
// Session Manager Reference
// ============================================================================

/**
 * Reference to the current session manager.
 * Set by REPL initialization to enable current session access.
 */
let _sessionManager: SessionManagerRef | null = null;

interface SessionManagerRef {
  getCurrentSession(): SessionMeta | null;
  recordMessage(
    role: "user" | "assistant",
    content: string,
    attachments?: string[]
  ): Promise<void>;
  /** Resume a session by ID (flushes pending, loads, sets current) */
  resumeSession?(sessionId: string): Promise<Session | null>;
}

/**
 * Set the session manager reference (called during REPL init)
 */
export function setSessionManager(manager: SessionManagerRef): void {
  _sessionManager = manager;
}

// ============================================================================
// Session API Object
// ============================================================================

/**
 * Create the session API object
 * Designed to be registered on globalThis for REPL access
 */
function createSessionApi() {
  return {
    /**
     * List all sessions (global)
     * @example (session.list)
     * @example (session.list {limit: 10})
     */
    list: (options?: {
      limit?: number;
      sortOrder?: "recent" | "oldest" | "alpha";
    }): Promise<SessionMeta[]> => {
      return listSessions({
        limit: options?.limit ?? 50,
        sortOrder: options?.sortOrder ?? "recent",
      });
    },

    /**
     * Load a specific session by ID
     * @example (session.get "abc123")
     */
    get: (sessionId: string): Promise<Session | null> => {
      assertString(sessionId, "session.get", "session.get requires a session ID string");

      return loadSession(sessionId);
    },

    /**
     * Resume a session by ID (flushes pending, loads, sets current)
     * This is the SSOT method for resuming sessions - uses manager's resumeSession.
     * @example (session.resume "abc123")
     */
    resume: (sessionId: string): Promise<Session | null> => {
      assertString(sessionId, "session.resume", "session.resume requires a session ID string");

      // 100% SSOT: Use manager's resumeSession only - no fallback bypass
      if (!_sessionManager?.resumeSession) {
        throw new ValidationError("Session manager not initialized - session.resume requires active REPL session", "session.resume");
      }

      return _sessionManager.resumeSession(sessionId);
    },

    /**
     * Get current session metadata
     * @example (session.current)
     */
    current: (): SessionMeta | null => {
      return _sessionManager?.getCurrentSession() ?? null;
    },

    /**
     * Record a message in the current session
     * @example (session.record "user" "Hello")
     * @example (session.record "assistant" "Hi there!")
     */
    record: async (
      role: "user" | "assistant",
      content: string,
      attachments?: string[]
    ): Promise<void> => {
      if (!_sessionManager) {
        throw new ValidationError("Session manager not initialized - session.record requires active REPL session", "session.record");
      }
      await _sessionManager.recordMessage(role, content, attachments);
    },

    /**
     * Delete a session
     * @example (session.remove "abc123")
     */
    remove: (sessionId: string): Promise<boolean> => {
      assertString(sessionId, "session.remove", "session.remove requires a session ID string");

      return deleteSession(sessionId);
    },

    /**
     * Export a session as plain text or markdown
     * @example (session.export "abc123")
     */
    export: (sessionId: string): Promise<string | null> => {
      assertString(sessionId, "session.export", "session.export requires a session ID string");

      return exportSession(sessionId);
    },

    /**
     * Get sessions directory path
     * @example (session.path)
     */
    get path(): string {
      return getSessionsDir();
    },

    /**
     * Get session count
     * @example (session.count)
     */
    count: async (): Promise<number> => {
      const sessions = await listSessions({ limit: 1000 });
      return sessions.length;
    },

    /**
     * Check if a session exists
     * @example (session.has "abc123")
     */
    has: async (sessionId: string): Promise<boolean> => {
      assertString(sessionId, "session.has", "session.has requires a session ID string");

      const session = await loadSession(sessionId);
      return session !== null;
    },
  };
}

/**
 * Default session API instance
 */
export const session = createSessionApi();
