/**
 * Session API Object
 *
 * Programmable access to HLVM conversation sessions (global).
 * Usage in REPL:
 *   (session.list)                  // List all conversation sessions
 *   (session.get "id")              // Load a specific conversation session
 *   (session.current)               // Get current conversation session info
 *   (session.remove "id")           // Delete a conversation session
 */

import {
  addRuntimeSessionMessage,
  createRuntimeSession,
  deleteRuntimeSession,
  getRuntimeSession,
  listRuntimeSessionMessages,
  listRuntimeSessions,
} from "../runtime/host-client.ts";
import type {
  RuntimeSession,
  RuntimeSessionMessage,
} from "../runtime/session-protocol.ts";
import type {
  Session,
  SessionMessage,
  SessionMeta,
} from "../cli/repl/session/types.ts";
import { getConversationsDbPath } from "../../common/paths.ts";
import { assertString } from "./validation.ts";

// ============================================================================
// Runtime Session Adapters
// ============================================================================

let _currentSession: SessionMeta | null = null;

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeTitle(title: string, sessionId: string): string {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : `Session ${sessionId.slice(0, 8)}`;
}

function adaptSessionMeta(session: RuntimeSession): SessionMeta {
  return {
    id: session.id,
    title: normalizeTitle(session.title, session.id),
    createdAt: parseTimestamp(session.created_at),
    updatedAt: parseTimestamp(session.updated_at),
    messageCount: session.message_count,
  };
}

function formatToolMessage(message: RuntimeSessionMessage): string {
  const label = message.tool_name?.trim();
  if (!label) return message.content;
  if (!message.content.trim()) return `[tool:${label}]`;
  return `[tool:${label}] ${message.content}`;
}

function parseImagePaths(value: string | null): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : undefined;
  } catch {
    return undefined;
  }
}

function adaptSessionMessage(
  message: RuntimeSessionMessage,
): SessionMessage | null {
  if (message.role === "system") return null;

  const role = message.role === "user" ? "user" : "assistant";
  const content = message.role === "tool"
    ? formatToolMessage(message)
    : message.content;
  const attachments = parseImagePaths(message.image_paths);

  return {
    role,
    content,
    ts: parseTimestamp(message.created_at),
    ...(attachments ? { attachments } : {}),
  };
}

function sortSessionMetas(
  sessions: SessionMeta[],
  sortOrder: "recent" | "oldest" | "alpha",
): SessionMeta[] {
  const sorted = [...sessions];
  switch (sortOrder) {
    case "oldest":
      sorted.sort((a, b) => a.updatedAt - b.updatedAt);
      break;
    case "alpha":
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "recent":
    default:
      sorted.sort((a, b) => b.updatedAt - a.updatedAt);
      break;
  }
  return sorted;
}

async function loadSessionById(sessionId: string): Promise<Session | null> {
  const runtimeSession = await getRuntimeSession(sessionId);
  if (!runtimeSession) return null;

  const messages = await listRuntimeSessionMessages(sessionId);
  return {
    meta: adaptSessionMeta(runtimeSession),
    messages: messages
      .map((message) => adaptSessionMessage(message))
      .filter((message): message is SessionMessage => message !== null),
  };
}

function formatSessionExport(session: Session): string {
  const lines: string[] = [
    `# ${session.meta.title}`,
    "",
    `**Created:** ${new Date(session.meta.createdAt).toLocaleString()}`,
    `**Messages:** ${session.meta.messageCount}`,
    "",
    "---",
    "",
  ];

  for (const message of session.messages) {
    const role = message.role === "user" ? "**You**" : "**Assistant**";
    const time = new Date(message.ts).toLocaleTimeString();
    lines.push(`### ${role} (${time})`);
    lines.push("");
    lines.push(message.content);
    lines.push("");
  }

  return lines.join("\n");
}

async function refreshCurrentSession(
  sessionId: string,
): Promise<SessionMeta | null> {
  const session = await getRuntimeSession(sessionId);
  if (!session) {
    _currentSession = null;
    return null;
  }

  _currentSession = adaptSessionMeta(session);
  return _currentSession;
}

// ============================================================================
// Internal Session State Helpers
// ============================================================================

export async function syncCurrentSession(
  sessionId: string | null,
): Promise<SessionMeta | null> {
  if (!sessionId) {
    _currentSession = null;
    return null;
  }
  return await refreshCurrentSession(sessionId);
}

export async function ensureCurrentSession(): Promise<SessionMeta> {
  if (_currentSession) return _currentSession;
  const created = await createRuntimeSession();
  _currentSession = adaptSessionMeta(created);
  return _currentSession;
}

export function clearCurrentSession(): void {
  _currentSession = null;
}

// ============================================================================
// Session API Object
// ============================================================================

function createSessionApi() {
  return {
    /**
     * List all conversation sessions (global)
     * @example (session.list)
     * @example (session.list {limit: 10})
     */
    list: async (options?: {
      limit?: number;
      sortOrder?: "recent" | "oldest" | "alpha";
    }): Promise<SessionMeta[]> => {
      const sessions = (await listRuntimeSessions()).map(adaptSessionMeta);
      const sorted = sortSessionMetas(
        sessions,
        options?.sortOrder ?? "recent",
      );
      return sorted.slice(0, options?.limit ?? 50);
    },

    /**
     * Load a specific conversation session by ID
     * @example (session.get "abc123")
     */
    get: (sessionId: string): Promise<Session | null> => {
      assertString(
        sessionId,
        "session.get",
        "session.get requires a session ID string",
      );
      return loadSessionById(sessionId);
    },

    /**
     * Resume a session by ID and mark it as the current conversation session.
     * @example (session.resume "abc123")
     */
    resume: async (sessionId: string): Promise<Session | null> => {
      assertString(
        sessionId,
        "session.resume",
        "session.resume requires a session ID string",
      );

      const loaded = await loadSessionById(sessionId);
      _currentSession = loaded?.meta ?? null;
      return loaded;
    },

    /**
     * Get current conversation session metadata
     * @example (session.current)
     */
    current: (): SessionMeta | null => {
      return _currentSession;
    },

    /**
     * Record a message in the current conversation session
     * @example (session.record "user" "Hello")
     * @example (session.record "assistant" "Hi there!")
     */
    record: async (
      role: "user" | "assistant",
      content: string,
      attachments?: string[],
    ): Promise<void> => {
      const current = await ensureCurrentSession();

      await addRuntimeSessionMessage(current.id, {
        role,
        content,
        sender_type: role === "user" ? "user" : "assistant",
        image_paths: attachments,
      });

      await refreshCurrentSession(current.id);
    },

    /**
     * Delete a session
     * @example (session.remove "abc123")
     */
    remove: async (sessionId: string): Promise<boolean> => {
      assertString(
        sessionId,
        "session.remove",
        "session.remove requires a session ID string",
      );

      const removed = await deleteRuntimeSession(sessionId);
      if (removed && _currentSession?.id === sessionId) {
        _currentSession = null;
      }
      return removed;
    },

    /**
     * Export a session as plain text or markdown
     * @example (session.export "abc123")
     */
    export: async (sessionId: string): Promise<string | null> => {
      assertString(
        sessionId,
        "session.export",
        "session.export requires a session ID string",
      );

      const loaded = await loadSessionById(sessionId);
      return loaded ? formatSessionExport(loaded) : null;
    },

    /**
     * Get conversations database path
     * @example (session.path)
     */
    get path(): string {
      return getConversationsDbPath();
    },

    /**
     * Get session count
     * @example (session.count)
     */
    count: async (): Promise<number> => {
      return (await listRuntimeSessions()).length;
    },

    /**
     * Check if a session exists
     * @example (session.has "abc123")
     */
    has: async (sessionId: string): Promise<boolean> => {
      assertString(
        sessionId,
        "session.has",
        "session.has requires a session ID string",
      );
      return await getRuntimeSession(sessionId) !== null;
    },
  };
}

/**
 * Default session API instance
 */
export const session = createSessionApi();
