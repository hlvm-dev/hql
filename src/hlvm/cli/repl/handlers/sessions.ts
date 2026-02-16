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

/**
 * @openapi
 * /api/sessions:
 *   get:
 *     tags: [Sessions]
 *     summary: List all sessions
 *     operationId: listSessions
 *     responses:
 *       '200':
 *         description: Array of sessions.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/SessionRow'
 */
export function handleListSessions(): Response {
  const sessions = listSessions();
  return Response.json({ sessions });
}

/**
 * @openapi
 * /api/sessions/stream:
 *   get:
 *     tags: [Sessions]
 *     summary: SSE stream of session changes
 *     operationId: streamSessions
 *     description: |
 *       Server-Sent Events stream. Events: session_created, session_updated,
 *       session_deleted, sessions_cleared, sessions_snapshot (on reconnect gap).
 *     parameters:
 *       - in: header
 *         name: Last-Event-ID
 *         schema:
 *           type: string
 *         description: Resume from this event ID on reconnect.
 *     responses:
 *       '200':
 *         description: SSE event stream.
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *         x-response-type: stream
 */
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

/**
 * @openapi
 * /api/sessions:
 *   post:
 *     tags: [Sessions]
 *     summary: Create a new session
 *     operationId: createSession
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *                 description: Optional client-supplied session ID.
 *               title:
 *                 type: string
 *     responses:
 *       '201':
 *         description: Session created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionRow'
 *       '400':
 *         description: Empty session id supplied.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @openapi
 * /api/sessions/{id}:
 *   get:
 *     tags: [Sessions]
 *     summary: Get a single session
 *     operationId: getSession
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Session object.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionRow'
 *       '404':
 *         description: Session not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export function handleGetSession(_req: Request, params: RouteParams): Response {
  const session = getSession(params.id);
  if (!session) return jsonError("Session not found", 404);
  return Response.json(session);
}

/**
 * @openapi
 * /api/sessions/{id}:
 *   patch:
 *     tags: [Sessions]
 *     summary: Update session title or metadata
 *     operationId: updateSession
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               metadata:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       '200':
 *         description: Updated session.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionRow'
 *       '404':
 *         description: Session not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @openapi
 * /api/sessions/{id}:
 *   delete:
 *     tags: [Sessions]
 *     summary: Delete a session and its messages
 *     operationId: deleteSession
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Session deleted.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deleted:
 *                   type: boolean
 *       '404':
 *         description: Session not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @openapi
 * /api/sessions:
 *   delete:
 *     tags: [Sessions]
 *     summary: Delete all sessions
 *     operationId: deleteAllSessions
 *     responses:
 *       '200':
 *         description: All sessions deleted.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deleted:
 *                   type: boolean
 *                 count:
 *                   type: integer
 */
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
