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
  getProjectHash(): string;
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
export function createSessionApi() {
  return {
    /**
     * List all sessions (global)
     * @example (session.list)
     * @example (session.list {:limit 10})
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
        throw new Error("session.get requires a session ID string");
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
        throw new Error("session.resume requires a session ID string");
      }

      // 100% SSOT: Use manager's resumeSession only - no fallback bypass
      if (!_sessionManager?.resumeSession) {
        throw new Error("Session manager not initialized - session.resume requires active REPL session");
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
        throw new Error("Session manager not initialized - session.listForProject requires active REPL session");
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
        throw new Error("Session manager not initialized - session.record requires active REPL session");
      }
      await _sessionManager.recordMessage(role, content, attachments);
    },

    /**
     * Delete a session
     * @example (session.remove "abc123")
     */
    remove: async (sessionId: string): Promise<boolean> => {
      if (!sessionId || typeof sessionId !== "string") {
        throw new Error("session.remove requires a session ID string");
      }

      return deleteSession(sessionId);
    },

    /**
     * Export a session as plain text or markdown
     * @example (session.export "abc123")
     */
    export: async (sessionId: string): Promise<string | null> => {
      if (!sessionId || typeof sessionId !== "string") {
        throw new Error("session.export requires a session ID string");
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
        throw new Error("session.has requires a session ID string");
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
