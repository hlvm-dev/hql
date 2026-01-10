/**
 * HQL REPL Session Manager
 * High-level API for session lifecycle and recording
 */

import type {
  SessionMeta,
  Session,
  SessionMessage,
  SessionInitOptions,
} from "./types.ts";
import {
  hashProjectPath,
  createSession,
  appendMessageOnly,
  updateSessionIndex,
  loadSession,
  listSessions,
  getLastSession,
  deleteSession as deleteSessionStorage,
  updateTitle,
  initSessionsDir,
} from "./storage.ts";

// ============================================================================
// SessionManager Class
// ============================================================================

/**
 * Manages session lifecycle for the HQL REPL.
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
  private projectHash: string;
  private initialized: boolean = false;

  // Lazy index update tracking
  private pendingMessageCount: number = 0;
  private lastUpdateTs: number = 0;
  private static readonly FLUSH_THRESHOLD = 10;

  /**
   * Create a SessionManager for a project.
   * @param projectPath - The project directory path (defaults to cwd)
   */
  constructor(projectPath: string = Deno.cwd()) {
    this.projectPath = projectPath;
    this.projectHash = hashProjectPath(projectPath);
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Initialize the session manager.
   * Creates or resumes a session based on options.
   *
   * @param options.continue - Resume the last session for this project
   * @param options.resumeId - Resume a specific session by ID
   * @param options.forceNew - Force creation of new session even if --continue
   * @returns The active session metadata
   */
  async initialize(options: SessionInitOptions = {}): Promise<SessionMeta> {
    // Ensure sessions directory exists
    await initSessionsDir();

    // Handle different initialization modes
    if (options.resumeId) {
      // Resume specific session
      const session = await this.resumeSession(options.resumeId);
      if (session) {
        this.currentSession = session.meta;
        this.initialized = true;
        return this.currentSession;
      }
      // Fall through to create new if session not found
    } else if (options.continue && !options.forceNew) {
      // Resume last session
      const lastSession = await getLastSession(this.projectPath);
      if (lastSession) {
        this.currentSession = lastSession;
        this.initialized = true;
        return this.currentSession;
      }
      // Fall through to create new if no previous session
    }

    // Create new session
    this.currentSession = await createSession(this.projectPath);
    this.initialized = true;
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
    if (!this.currentSession) {
      throw new Error("SessionManager not initialized. Call initialize() first.");
    }

    // Append message to session file (O(1))
    const message = await appendMessageOnly(
      this.projectHash,
      this.currentSession.id,
      role,
      content,
      attachments
    );

    // Update local metadata
    this.currentSession = {
      ...this.currentSession,
      updatedAt: message.ts,
      messageCount: this.currentSession.messageCount + 1,
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
    const session = await loadSession(this.projectHash, sessionId);
    if (session) {
      this.currentSession = session.meta;
    }
    return session;
  }

  /**
   * List all sessions for the current project.
   * @param limit - Maximum number of sessions to return (default 50)
   */
  async listForProject(limit: number = 50): Promise<SessionMeta[]> {
    return listSessions({
      projectHash: this.projectHash,
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
    const result = await deleteSessionStorage(this.projectHash, sessionId);

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
      throw new Error("No active session to rename.");
    }

    await updateTitle(this.projectHash, this.currentSession.id, title);

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
   * Get the current session metadata.
   */
  getCurrentSession(): SessionMeta | null {
    return this.currentSession;
  }

  /**
   * Get the current session's messages.
   */
  async getSessionMessages(): Promise<readonly SessionMessage[]> {
    if (!this.currentSession) {
      return [];
    }

    const session = await loadSession(this.projectHash, this.currentSession.id);
    return session?.messages ?? [];
  }

  /**
   * Get the project path this manager is for.
   */
  getProjectPath(): string {
    return this.projectPath;
  }

  /**
   * Get the project hash.
   */
  getProjectHash(): string {
    return this.projectHash;
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
