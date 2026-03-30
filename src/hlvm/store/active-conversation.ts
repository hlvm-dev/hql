/**
 * Active conversation state
 *
 * Maintains the single public-facing conversation surface for the runtime host
 * while preserving session-backed storage internally.
 */

import {
  createSession,
  deleteHostStateValue,
  deleteSession,
  getHostStateValue,
  getOrCreateSession,
  getSession,
  listSessions,
  setHostStateValue,
} from "./conversation-store.ts";


const MAX_INACTIVE_SESSIONS = 20;
const MAX_INACTIVE_AGE_MS = 1000 * 60 * 60 * 24 * 7;
const ACTIVE_CONVERSATION_SESSION_KEY = "active_conversation_session_id";

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
  setHostStateValue(ACTIVE_CONVERSATION_SESSION_KEY, session.id);
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

  const persisted = getPersistedActiveConversationSession();
  if (persisted) return bindActiveConversationSession(persisted);

  const mostRecent = getMostRecentConversationSession();
  if (mostRecent) return bindActiveConversationSession(mostRecent);

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

function pruneInactiveSessions(): void {
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

function getPersistedActiveConversationSession() {
  const persistedSessionId = getHostStateValue(ACTIVE_CONVERSATION_SESSION_KEY)
    ?.trim();
  if (!persistedSessionId) return null;
  const existing = getSession(persistedSessionId);
  if (existing) return existing;
  deleteHostStateValue(ACTIVE_CONVERSATION_SESSION_KEY);
  return null;
}

function getMostRecentConversationSession() {
  const sessions = listSessions();
  return sessions[0] ?? null;
}

export async function closeActiveConversationSession(): Promise<void> {
  activeSessionId = null;
}

export function _resetActiveConversationForTesting(): void {
  activeSessionId = null;
}
