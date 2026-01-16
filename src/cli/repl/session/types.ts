/**
 * HQL REPL Session Types
 * Type definitions for session persistence and management
 */

// ============================================================================
// Session Storage Types (JSONL format)
// ============================================================================

/**
 * Session metadata stored in index.jsonl for fast listing
 */
export interface SessionMeta {
  readonly id: string;
  readonly projectHash: string;
  readonly projectPath: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly messageCount: number;
}

/**
 * Session header record - first line of session JSONL file
 */
export interface SessionHeader {
  readonly type: "meta";
  readonly version: number;
  readonly id: string;
  readonly projectHash: string;
  readonly projectPath: string;
  readonly createdAt: number;
}

/**
 * Message record in session JSONL file
 */
export interface SessionMessage {
  readonly type: "message";
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly ts: number;
  readonly attachments?: readonly string[];
}

/**
 * Title update record - allows renaming sessions
 */
export interface SessionTitleRecord {
  readonly type: "title";
  readonly title: string;
  readonly ts: number;
}

/**
 * Union type for all session JSONL records
 */
export type SessionRecord = SessionHeader | SessionMessage | SessionTitleRecord;

/**
 * Fully loaded session with metadata and messages
 */
export interface Session {
  readonly meta: SessionMeta;
  readonly messages: readonly SessionMessage[];
}

// ============================================================================
// Session Manager Types
// ============================================================================

/**
 * Options for initializing SessionManager
 */
export interface SessionInitOptions {
  /** Resume the last session for this project */
  readonly continue?: boolean;
  /** Resume a specific session by ID */
  readonly resumeId?: string;
  /** Force creation of new session even if last exists */
  readonly forceNew?: boolean;
  /** Open session picker on startup (--resume without ID) */
  readonly openPicker?: boolean;
}

/**
 * Options for listing sessions (global - no project filtering)
 */
export interface ListSessionsOptions {
  /** Maximum number of sessions to return */
  readonly limit?: number;
  /** Sort order */
  readonly sortOrder?: "recent" | "oldest" | "alpha";
}

