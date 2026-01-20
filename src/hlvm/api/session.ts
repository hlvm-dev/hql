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
  /** List sessions for the current project */
  listForProject?(limit?: number): Promise<SessionMeta[]>;
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
    list: async (options?: {
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
    get: async (sessionId: string): Promise<Session | null> => {
      if (!sessionId || typeof sessionId !== "string") {
        throw new ValidationError("session.get requires a session ID string", "session.get");
      }

      return loadSession(sessionId);
    },

    /**
     * Resume a session by ID (flushes pending, loads, sets current)
     * This is the SSOT method for resuming sessions - uses manager's resumeSession.
     * @example (session.resume "abc123")
     */
    resume: async (sessionId: string): Promise<Session | null> => {
      if (!sessionId || typeof sessionId !== "string") {
        throw new ValidationError("session.resume requires a session ID string", "session.resume");
      }

      // 100% SSOT: Use manager's resumeSession only - no fallback bypass
      if (!_sessionManager?.resumeSession) {
        throw new ValidationError("Session manager not initialized - session.resume requires active REPL session", "session.resume");
      }

      return _sessionManager.resumeSession(sessionId);
    },

    /**
     * List sessions for the current project.
     * @deprecated Use list() if you want the global list instead
     * @example (session.listForProject 20)
     */
    listForProject: async (limit: number = 50): Promise<SessionMeta[]> => {
      if (!_sessionManager?.listForProject) {
        throw new ValidationError("Session manager not initialized - session.listForProject requires active REPL session", "session.listForProject");
      }
      return _sessionManager.listForProject(limit);
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
    remove: async (sessionId: string): Promise<boolean> => {
      if (!sessionId || typeof sessionId !== "string") {
        throw new ValidationError("session.remove requires a session ID string", "session.remove");
      }

      return deleteSession(sessionId);
    },

    /**
     * Export a session as plain text or markdown
     * @example (session.export "abc123")
     */
    export: async (sessionId: string): Promise<string | null> => {
      if (!sessionId || typeof sessionId !== "string") {
        throw new ValidationError("session.export requires a session ID string", "session.export");
      }

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
      if (!sessionId || typeof sessionId !== "string") {
        throw new ValidationError("session.has requires a session ID string", "session.has");
      }

      const session = await loadSession(sessionId);
      return session !== null;
    },
  };
}

/**
 * Default session API instance
 */
export const session = createSessionApi();
