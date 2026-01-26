/**
 * HLVM REPL Session Manager
 * High-level API for session lifecycle and recording
 */

import type {
  SessionMeta,
  Session,
  SessionMessage,
  SessionInitOptions,
} from "./types.ts";
import {
  createSession,
  appendMessageOnly,
  updateSessionIndex,
  loadSession,
  listSessions,
  getLastSession,
  deleteSession as deleteSessionStorage,
  updateTitle,
} from "./storage.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import { RuntimeError } from "../../../../common/error.ts";

// ============================================================================
// SessionManager Class
// ============================================================================

/**
 * Manages session lifecycle for the HLVM REPL.
 *
 * Usage:
 * ```typescript
 * const manager = new SessionManager("/path/to/project");
 * await manager.initialize({ continue: true });
 * await manager.recordMessage("user", "(def x 10)");
 * await manager.recordMessage("assistant", "10");
 * ```
 */
export class SessionManager {
  private currentSession: SessionMeta | null = null;
  private projectPath: string;
  private initialized: boolean = false;

  // Lazy session creation - defer until first message
  private sessionDeferred: boolean = false;

  // Lazy index update tracking
  private pendingMessageCount: number = 0;
  private lastUpdateTs: number = 0;
  private static readonly FLUSH_THRESHOLD = 10;

  /**
   * Create a SessionManager for a project.
   * @param projectPath - The project directory path (defaults to cwd)
   */
  constructor(projectPath: string = getPlatform().process.cwd()) {
    this.projectPath = projectPath;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Initialize the session manager.
   * Resumes a session if specified, otherwise defers creation until first message.
   *
   * @param options.continue - Resume the last session for this project
   * @param options.resumeId - Resume a specific session by ID
   * @param options.forceNew - Force creation of new session immediately
   * @returns The active session metadata, or null if deferred
   */
  async initialize(options: SessionInitOptions = {}): Promise<SessionMeta | null> {
    // Note: Sessions directory is initialized via initializeRuntime()
    // Handle different initialization modes
    if (options.resumeId) {
      // Resume specific session
      const session = await this.resumeSession(options.resumeId);
      if (session) {
        this.currentSession = session.meta;
        this.initialized = true;
        this.sessionDeferred = false;
        return this.currentSession;
      }
      // Fall through to defer if session not found
    } else if (options.continue && !options.forceNew) {
      // Resume last session (global)
      const lastSession = await getLastSession();
      if (lastSession) {
        this.currentSession = lastSession;
        this.initialized = true;
        this.sessionDeferred = false;
        return this.currentSession;
      }
      // Fall through to defer if no previous session
    } else if (options.forceNew) {
      // Force new session immediately
      this.currentSession = await createSession(this.projectPath);
      this.initialized = true;
      this.sessionDeferred = false;
      return this.currentSession;
    }

    // Defer session creation until first message (lazy creation)
    // This prevents empty sessions when user opens REPL and exits without typing
    this.sessionDeferred = true;
    this.initialized = true;
    return null;
  }

  /**
   * Ensure a session exists, creating one lazily if deferred.
   * Called internally before recording messages.
   */
  private async ensureSession(): Promise<SessionMeta> {
    if (this.currentSession) {
      return this.currentSession;
    }

    if (!this.sessionDeferred) {
      throw new RuntimeError("SessionManager not initialized. Call initialize() first.");
    }

    // Create session now (lazy creation on first message)
    this.currentSession = await createSession(this.projectPath);
    this.sessionDeferred = false;
    return this.currentSession;
  }

  /**
   * Close the session manager.
   * Flushes any pending index updates.
   */
  async close(): Promise<void> {
    // Flush any pending index updates
    await this.flushIndexUpdate();
    this.initialized = false;
  }

  /**
   * Flush pending index updates to disk.
   * Called automatically when threshold reached or on close().
   */
  private async flushIndexUpdate(): Promise<void> {
    if (this.pendingMessageCount > 0 && this.currentSession) {
      await updateSessionIndex(
        this.currentSession.id,
        this.currentSession.messageCount,
        this.lastUpdateTs
      );
      this.pendingMessageCount = 0;
    }
  }

  // ==========================================================================
  // Recording
  // ==========================================================================

  /**
   * Record a message in the current session.
   * Called by the evaluator after each turn.
   * Uses lazy index updates for O(1) per-message performance.
   * Creates session lazily on first message if deferred.
   *
   * @param role - "user" or "assistant"
   * @param content - The message content
   * @param attachments - Optional file attachment paths
   */
  async recordMessage(
    role: "user" | "assistant",
    content: string,
    attachments?: readonly string[]
  ): Promise<void> {
    // Ensure session exists (creates lazily if deferred)
    const session = await this.ensureSession();

    // Append message to session file (O(1))
    const message = await appendMessageOnly(
      session.id,
      role,
      content,
      attachments
    );

    // Update local metadata
    this.currentSession = {
      ...session,
      updatedAt: message.ts,
      messageCount: session.messageCount + 1,
    };

    // Track for lazy index update
    this.pendingMessageCount++;
    this.lastUpdateTs = message.ts;

    // Flush index periodically (every FLUSH_THRESHOLD messages)
    if (this.pendingMessageCount >= SessionManager.FLUSH_THRESHOLD) {
      await this.flushIndexUpdate();
    }
  }

  // ==========================================================================
  // Session Operations
  // ==========================================================================

  /**
   * Create a new session and switch to it.
   * @param title - Optional title for the session
   */
  async newSession(title?: string): Promise<SessionMeta> {
    // Flush pending updates from previous session
    await this.flushIndexUpdate();
    this.currentSession = await createSession(this.projectPath, title);
    this.sessionDeferred = false;
    return this.currentSession;
  }

  /**
   * Resume a session by ID.
   * @param sessionId - The session ID to resume
   * @returns The loaded session or null if not found
   */
  async resumeSession(sessionId: string): Promise<Session | null> {
    // Flush pending updates from previous session
    await this.flushIndexUpdate();
    const session = await loadSession(sessionId);
    if (session) {
      this.currentSession = session.meta;
    }
    return session;
  }

  /**
   * List all sessions (global).
   * @param limit - Maximum number of sessions to return (default 50)
   */
  list(limit: number = 50): Promise<SessionMeta[]> {
    return listSessions({
      limit,
      sortOrder: "recent",
    });
  }

  /**
   * Delete a session.
   * @param sessionId - The session ID to delete
   * @returns true if deleted, false if not found
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const result = await deleteSessionStorage(sessionId);

    // If we deleted the current session, clear it
    if (result && this.currentSession?.id === sessionId) {
      this.currentSession = null;
    }

    return result;
  }

  /**
   * Rename the current session.
   * @param title - The new title
   */
  async renameSession(title: string): Promise<void> {
    if (!this.currentSession) {
      throw new RuntimeError("No active session to rename.");
    }

    await updateTitle(this.currentSession.id, title);

    // Update local metadata
    this.currentSession = {
      ...this.currentSession,
      title,
      updatedAt: Date.now(),
    };
  }

  // ==========================================================================
  // Getters
  // ==========================================================================

  /**
   * Get the current session's messages.
   */
  async getSessionMessages(): Promise<readonly SessionMessage[]> {
    if (!this.currentSession) {
      return [];
    }

    const session = await loadSession(this.currentSession.id);
    return session?.messages ?? [];
  }

  /**
   * Get the current session metadata.
   */
  getCurrentSession(): SessionMeta | null {
    return this.currentSession;
  }

  /**
   * Get the project path this manager is for.
   */
  getProjectPath(): string {
    return this.projectPath;
  }

  /**
   * Check if the manager has been initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if there's an active session.
   */
  hasActiveSession(): boolean {
    return this.currentSession !== null;
  }

}
