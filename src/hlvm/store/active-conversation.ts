/**
 * Active conversation state
 *
 * Maintains the single public-facing conversation surface for the runtime host
 * while preserving session-backed storage internally.
 */

import {
  createSession,
  deleteSession,
  getOrCreateSession,
  getSession,
  listSessions,
} from "./conversation-store.ts";


const MAX_INACTIVE_SESSIONS = 20;
const MAX_INACTIVE_AGE_MS = 1000 * 60 * 60 * 24 * 7;

let activeSessionId: string | null = null;

function getExistingActiveConversationSession() {
  if (!activeSessionId) return null;
  const existing = getSession(activeSessionId);
  if (existing) return existing;
  activeSessionId = null;
  return null;
}

function bindActiveConversationSession<T extends { id: string }>(
  session: T,
): T {
  activeSessionId = session.id;
  return session;
}

function createConversationSession(id?: string) {
  pruneInactiveSessions();
  return createSession("", id);
}

function getOrCreateConversationSession(id: string) {
  pruneInactiveSessions();
  return getOrCreateSession(id);
}

export function getActiveConversationSessionId(): string {
  return ensureActiveConversationSession().id;
}

export function ensureActiveConversationSession() {
  const existing = getExistingActiveConversationSession();
  if (existing) return existing;
  return bindActiveConversationSession(createConversationSession());
}

export function resolveConversationSessionId(
  requestedSessionId?: string | null,
  options: { stateless?: boolean } = {},
): string {
  const stateless = options.stateless === true;
  const trimmed = requestedSessionId?.trim();
  if (trimmed) {
    const session = getOrCreateConversationSession(trimmed);
    if (!stateless) bindActiveConversationSession(session);
    return session.id;
  }

  if (stateless) {
    return createConversationSession().id;
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
  activeSessionId = null;
}

export function _resetActiveConversationForTesting(): void {
  activeSessionId = null;
}
