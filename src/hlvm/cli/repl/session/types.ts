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
  /** Explicitly continue the latest global session. */
  readonly continue?: boolean;
  /** Resume a specific session by ID */
  readonly resumeId?: string;
  /** Force creation of new session even if last exists */
  readonly forceNew?: boolean;
  /** Open session picker on startup (--resume without ID) */
  readonly openPicker?: boolean;
}

/**
 * Parse session-related CLI flags into SessionInitOptions.
 * Single source of truth for --continue/-c, --resume/-r, --new flag parsing.
 */
export function parseSessionFlags(args: string[]): SessionInitOptions {
  let continueSession = false;
  let resumeId: string | undefined;
  let forceNew = false;
  let openPicker = false;

  if (args.includes("--continue") || args.includes("-c")) {
    continueSession = true;
  }

  const resumeIndex = args.findIndex((a) => a === "--resume" || a === "-r");
  if (resumeIndex !== -1) {
    const nextArg = args[resumeIndex + 1];
    if (nextArg && !nextArg.startsWith("-")) {
      resumeId = nextArg;
    } else {
      openPicker = true;
    }
  }

  if (args.includes("--new")) {
    forceNew = true;
  }

  return { continue: continueSession, resumeId, forceNew, openPicker };
}

