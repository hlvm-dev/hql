/**
 * Session Handlers
 *
 * CRUD endpoints for conversation sessions.
 */

import {
  createSession,
  deleteAllSessions,
  deleteSession,
  getSession,
  listSessions,
  updateSession,
} from "../../../store/conversation-store.ts";
import {
  pushSSEEvent,
  subscribe,
  replayAfter,
  clearSessionBuffer,
  SESSIONS_CHANNEL,
} from "../../../store/sse-store.ts";
import { cancelSessionRequests } from "./chat.ts";
import type { RouteParams } from "../http-router.ts";
import { parseJsonBody, jsonError, formatSSE, createSSEResponse } from "../http-utils.ts";

export function handleListSessions(): Response {
  const sessions = listSessions();
  return Response.json({ sessions });
}

export function handleSessionsStream(req: Request): Response {
  const lastEventId = req.headers.get("Last-Event-ID");

  return createSSEResponse(req, (emit) => {
    const replay = replayAfter(SESSIONS_CHANNEL, lastEventId);
    if (replay.gapDetected) {
      const snapshot = JSON.stringify({ sessions: listSessions() });
      emit(`event: sessions_snapshot\ndata: ${snapshot}\n\n`);
    } else {
      for (const event of replay.events) {
        emit(formatSSE(event));
      }
    }

    const unsubscribe = subscribe(SESSIONS_CHANNEL, (event) => {
      emit(formatSSE(event));
    });
    return unsubscribe;
  });
}

export async function handleCreateSession(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<{ id?: string; title?: string }>(req);
  if (!parsed.ok) return parsed.response;

  const requestedId = parsed.value.id?.trim();
  if (parsed.value.id !== undefined && !requestedId) {
    return jsonError("Session id cannot be empty", 400);
  }

  const title = parsed.value.title?.trim();
  const session = createSession(title, requestedId);
  pushSSEEvent(SESSIONS_CHANNEL, "session_created", { session_id: session.id });
  return Response.json(session, { status: 201 });
}

export function handleGetSession(_req: Request, params: RouteParams): Response {
  const session = getSession(params.id);
  if (!session) return jsonError("Session not found", 404);
  return Response.json(session);
}

export async function handleUpdateSession(
  req: Request,
  params: RouteParams,
): Promise<Response> {
  const parsed = await parseJsonBody<{ title?: string; metadata?: string | null }>(req);
  if (!parsed.ok) return parsed.response;

  const session = updateSession(params.id, parsed.value);
  if (!session) return jsonError("Session not found", 404);
  pushSSEEvent(params.id, "session_updated", { session_id: params.id });
  pushSSEEvent(SESSIONS_CHANNEL, "session_updated", { session_id: params.id });
  return Response.json(session);
}

export function handleDeleteSession(
  _req: Request,
  params: RouteParams,
): Response {
  const sessionId = params.id;
  cancelSessionRequests(sessionId);

  const deleted = deleteSession(sessionId);
  if (!deleted) return jsonError("Session not found", 404);

  pushSSEEvent(sessionId, "session_deleted", { session_id: sessionId });
  pushSSEEvent(SESSIONS_CHANNEL, "session_deleted", { session_id: sessionId });
  clearSessionBuffer(sessionId);
  return Response.json({ deleted: true });
}

export function handleDeleteAllSessions(): Response {
  const sessions = listSessions();
  for (const s of sessions) {
    cancelSessionRequests(s.id);
  }
  const count = deleteAllSessions();
  for (const s of sessions) {
    pushSSEEvent(s.id, "session_deleted", { session_id: s.id });
    clearSessionBuffer(s.id);
  }
  pushSSEEvent(SESSIONS_CHANNEL, "sessions_cleared", { count });
  return Response.json({ deleted: true, count });
}
