/**
 * Session Handlers
 *
 * CRUD endpoints for conversation sessions.
 */

import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  updateSession,
} from "../../../store/conversation-store.ts";
import { pushSSEEvent, clearSessionBuffer } from "../../../store/sse-store.ts";
import { cancelSessionRequests } from "./chat.ts";
import type { RouteParams } from "../http-router.ts";
import { parseJsonBody, jsonError } from "../http-utils.ts";

export function handleListSessions(): Response {
  const sessions = listSessions();
  return Response.json({ sessions });
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
  clearSessionBuffer(sessionId);
  return Response.json({ deleted: true });
}
