/**
 * Active conversation state
 *
 * Maintains the single public-facing conversation surface for the runtime host
 * while preserving session-backed storage internally.
 */

import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
} from "./conversation-store.ts";
import { loadAllMessages } from "./message-utils.ts";
import { persistConversationFacts } from "../memory/mod.ts";

const MAX_INACTIVE_SESSIONS = 20;
const MAX_INACTIVE_AGE_MS = 1000 * 60 * 60 * 24 * 7;

let activeSessionId: string | null = null;

export function getActiveConversationSessionId(): string {
  return ensureActiveConversationSession().id;
}

export function ensureActiveConversationSession() {
  if (activeSessionId) {
    const existing = getSession(activeSessionId);
    if (existing) return existing;
    activeSessionId = null;
  }

  pruneInactiveSessions();
  const session = createSession("");
  activeSessionId = session.id;
  return session;
}

export function resolveConversationSessionId(
  requestedSessionId?: string | null,
): string {
  const trimmed = requestedSessionId?.trim();
  if (trimmed) {
    const existing = getSession(trimmed);
    if (existing) {
      activeSessionId = trimmed;
      return trimmed;
    }
  }

  return ensureActiveConversationSession().id;
}

export function pruneInactiveSessions(): void {
  const now = Date.now();
  const sessions = listSessions()
    .filter((session) => session.id !== activeSessionId)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));

  for (let index = 0; index < sessions.length; index++) {
    const session = sessions[index];
    const updatedAt = Date.parse(session.updated_at);
    const overAge = Number.isFinite(updatedAt)
      ? now - updatedAt > MAX_INACTIVE_AGE_MS
      : false;
    const overCount = index >= MAX_INACTIVE_SESSIONS;
    if (overAge || overCount) {
      deleteSession(session.id);
    }
  }
}

export async function closeActiveConversationSession(): Promise<void> {
  const sessionId = activeSessionId;
  if (!sessionId) return;

  const messages = loadAllMessages(sessionId)
    .filter((message) =>
      message.role === "user" || message.role === "assistant" ||
      message.role === "tool"
    )
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  if (messages.length > 0) {
    try {
      persistConversationFacts(messages, {
        source: "extracted",
      });
    } catch {
      // Best-effort only; shutdown should not fail on memory flush.
    }
  }

  activeSessionId = null;
}
