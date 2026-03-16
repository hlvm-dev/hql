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
import { getAttachmentDisplayName } from "../attachments/metadata.ts";
import { getAttachmentRecords } from "../attachments/service.ts";
import type { AttachmentKind } from "../attachments/types.ts";
import { parseStoredStringArray } from "../store/message-utils.ts";
import { ValidationError } from "../../common/error.ts";
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
    metadata: session.metadata ?? null,
  };
}

function getLegacyAttachmentPaths(
  message: RuntimeSessionMessage,
): string[] | undefined {
  return message.legacy_image_paths;
}

function normalizeAttachmentIds(attachmentIds: unknown): string[] {
  if (!attachmentIds) return [];
  if (Array.isArray(attachmentIds)) {
    return attachmentIds.filter((id) => typeof id === "string");
  }

  if (typeof attachmentIds === "string") {
    const parsed = parseStoredStringArray(attachmentIds);
    if (parsed) return parsed;
    return [attachmentIds];
  }

  return [];
}

async function validateAttachmentIdsForRecord(
  attachmentIds: string[] | undefined,
): Promise<string[] | undefined> {
  if (!attachmentIds || attachmentIds.length === 0) return undefined;

  const records = await getAttachmentRecords(attachmentIds);
  if (records.length !== attachmentIds.length) {
    const known = new Set(records.map((record) => record.id));
    const missing = attachmentIds.filter((id) => !known.has(id));
    if (missing.length === 1) {
      throw new ValidationError(
        `Unknown attachment ID: ${missing[0]}`,
        "session.record",
      );
    }
    throw new ValidationError(
      `Unknown attachment IDs: ${missing.join(", ")}`,
      "session.record",
    );
  }

  return attachmentIds;
}

function createAttachmentLabelResolver() {
  const kindByAttachmentId = new Map<string, AttachmentKind>();

  return async (
    attachmentIds: readonly string[],
  ): Promise<string[] | undefined> => {
    if (attachmentIds.length === 0) return undefined;

    const missingIds = attachmentIds.filter((attachmentId) =>
      !kindByAttachmentId.has(attachmentId)
    );
    if (missingIds.length > 0) {
      const records = await getAttachmentRecords(missingIds);
      for (const record of records) {
        kindByAttachmentId.set(record.id, record.kind);
      }
    }

    return attachmentIds.map((attachmentId, index) =>
      getAttachmentDisplayName(
        kindByAttachmentId.get(attachmentId) ?? "file",
        index + 1,
      )
    );
  };
}

function formatSessionMessageBody(message: SessionMessage): string {
  const lines: string[] = [];
  if (message.attachments?.length) {
    lines.push(message.attachments.join(" "));
  }

  const content = message.role === "tool" && message.toolName
    ? (message.content.trim()
      ? `[tool:${message.toolName}] ${message.content}`
      : `[tool:${message.toolName}]`)
    : message.content;
  if (content.length > 0) {
    lines.push(content);
  }

  return lines.join("\n");
}

function parseToolMessageMetadata(
  value: string | null,
): { argsSummary?: string; success?: boolean } {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    const record = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!record || typeof record !== "object") return {};
    return {
      argsSummary:
        typeof (record as { argsSummary?: unknown }).argsSummary === "string"
          ? (record as { argsSummary: string }).argsSummary
          : undefined,
      success: typeof (record as { success?: unknown }).success === "boolean"
        ? (record as { success: boolean }).success
        : undefined,
    };
  } catch {
    return {};
  }
}

async function adaptSessionMessage(
  message: RuntimeSessionMessage,
  resolveAttachmentLabels: (
    attachmentIds: readonly string[],
  ) => Promise<string[] | undefined>,
): Promise<SessionMessage | null> {
  if (message.role === "system" || message.cancelled) return null;

  const role = message.role === "tool"
    ? "tool"
    : message.role === "user"
    ? "user"
    : "assistant";
  const attachmentIds = normalizeAttachmentIds(message.attachment_ids);
  const attachments = attachmentIds.length > 0
    ? await resolveAttachmentLabels(attachmentIds)
    : getLegacyAttachmentPaths(message);
  const toolMeta = message.role === "tool"
    ? parseToolMessageMetadata(message.tool_calls)
    : {};

  return {
    role,
    content: message.content,
    ts: parseTimestamp(message.created_at),
    ...(message.tool_name ? { toolName: message.tool_name } : {}),
    ...(toolMeta.argsSummary ? { toolArgsSummary: toolMeta.argsSummary } : {}),
    ...(typeof toolMeta.success === "boolean"
      ? { toolSuccess: toolMeta.success }
      : {}),
    ...(attachments ? { attachments } : {}),
  };
}

function filterCancelledRequestGroups(
  messages: RuntimeSessionMessage[],
): RuntimeSessionMessage[] {
  const filtered: RuntimeSessionMessage[] = [];
  let index = 0;

  while (index < messages.length) {
    const current = messages[index];
    if (!current.request_id) {
      if (!current.cancelled) {
        filtered.push(current);
      }
      index += 1;
      continue;
    }

    let end = index + 1;
    while (
      end < messages.length &&
      messages[end].request_id === current.request_id
    ) {
      end += 1;
    }

    let hasCancelled = false;
    for (let i = index; i < end; i++) {
      if (messages[i].cancelled !== 0) {
        hasCancelled = true;
        break;
      }
    }
    if (!hasCancelled) {
      for (let i = index; i < end; i++) {
        filtered.push(messages[i]);
      }
    }
    index = end;
  }

  return filtered;
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

  const resolveAttachmentLabels = createAttachmentLabelResolver();
  const messages = await Promise.all(
    filterCancelledRequestGroups(
      await listRuntimeSessionMessages(sessionId),
    ).map((message) => adaptSessionMessage(message, resolveAttachmentLabels)),
  );
  return {
    meta: adaptSessionMeta(runtimeSession),
    messages: messages.filter((message): message is SessionMessage =>
      message !== null
    ),
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
    const role = message.role === "user"
      ? "**You**"
      : message.role === "tool"
      ? `**Tool${message.toolName ? `:${message.toolName}` : ""}**`
      : "**Assistant**";
    const time = new Date(message.ts).toLocaleTimeString();
    lines.push(`### ${role} (${time})`);
    lines.push("");
    lines.push(formatSessionMessageBody(message));
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
      const normalizedAttachmentIds = await validateAttachmentIdsForRecord(
        attachments,
      );
      const current = await ensureCurrentSession();

      await addRuntimeSessionMessage(current.id, {
        role,
        content,
        sender_type: role === "user" ? "user" : "assistant",
        attachment_ids: normalizedAttachmentIds,
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
