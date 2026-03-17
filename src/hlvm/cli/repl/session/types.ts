/**
 * HLVM Session Types
 * Shared conversation session shapes plus CLI flag parsing.
 */

/**
 * Conversation session metadata
 */
export interface SessionMeta {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly messageCount: number;
  readonly metadata?: string | null;
}

/**
 * Conversation message
 */
export interface SessionMessage {
  readonly role: "user" | "assistant" | "tool";
  readonly content: string;
  readonly ts: number;
  readonly attachments?: readonly string[];
  readonly toolName?: string;
  readonly toolArgsSummary?: string;
  readonly toolSuccess?: boolean;
}

/**
 * Fully loaded session with metadata and messages
 */
export interface Session {
  readonly meta: SessionMeta;
  readonly messages: readonly SessionMessage[];
}

/**
 * Session startup flags
 */
export interface SessionInitOptions {
}

/**
 * Parse session-related CLI flags into SessionInitOptions.
 * Single source of truth for --continue/-c, --resume/-r, --new flag parsing.
 */
export function parseSessionFlags(args: string[]): SessionInitOptions {
  void args;
  return {};
}
