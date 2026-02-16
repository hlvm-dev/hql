/**
 * Messages Handler
 *
 * Paginated message retrieval and CRUD for session messages.
 */

import {
  getMessages,
  getMessage,
  getMessageByClientTurnId,
  getSession,
  insertMessage,
  updateMessage,
  deleteMessage,
} from "../../../store/conversation-store.ts";
import { pushSSEEvent, SESSIONS_CHANNEL } from "../../../store/sse-store.ts";
import type { RouteParams } from "../http-router.ts";
import { parseJsonBody, jsonError } from "../http-utils.ts";

// MARK: - Private Helpers

function requireSession(params: RouteParams): { sessionId: string } | Response {
  const sessionId = params.id;
  const session = getSession(sessionId);
  if (!session) return jsonError("Session not found", 404);
  return { sessionId };
}

function parsePositiveIntegerId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function requireMessage(params: RouteParams, sessionId: string): { messageId: number } | Response {
  const raw = params.messageId;
  const messageId = parsePositiveIntegerId(raw);

  if (messageId !== null) {
    const message = getMessage(messageId);
    if (message && message.session_id === sessionId) return { messageId };
  }

  const byTurnId = getMessageByClientTurnId(sessionId, raw);
  if (byTurnId) return { messageId: byTurnId.id };

  if (messageId === null) return jsonError("Invalid messageId", 400);
  return jsonError("Message not found", 404);
}

// MARK: - Public Methods

/**
 * @openapi
 * /api/sessions/{id}/messages:
 *   get:
 *     tags: [Messages]
 *     summary: List messages in a session
 *     operationId: getMessages
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *       - in: query
 *         name: after_order
 *         schema:
 *           type: integer
 *         description: Return only messages with order > this value.
 *     responses:
 *       '200':
 *         description: Paginated messages.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PagedMessages'
 *       '404':
 *         description: Session not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export function handleGetMessages(
  req: Request,
  params: RouteParams,
): Response {
  const session = requireSession(params);
  if (session instanceof Response) return session;

  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
  const sort = url.searchParams.get("sort") === "asc" ? "asc" as const : "desc" as const;
  const afterOrderRaw = url.searchParams.get("after_order");
  const afterOrder = afterOrderRaw ? parseInt(afterOrderRaw, 10) : undefined;

  const result = getMessages(session.sessionId, {
    limit: isNaN(limit) ? 50 : limit,
    offset: isNaN(offset) ? 0 : offset,
    sort,
    after_order: afterOrder !== undefined && !isNaN(afterOrder) ? afterOrder : undefined,
  });

  return Response.json(result);
}

/**
 * @openapi
 * /api/sessions/{id}/messages/{messageId}:
 *   get:
 *     tags: [Messages]
 *     summary: Get a single message
 *     operationId: getMessage
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID.
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *         description: Message ID (integer) or client_turn_id.
 *     responses:
 *       '200':
 *         description: Message object.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageRow'
 *       '400':
 *         description: Invalid messageId.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Session or message not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export function handleGetMessage(
  _req: Request,
  params: RouteParams,
): Response {
  const session = requireSession(params);
  if (session instanceof Response) return session;

  const msg = requireMessage(params, session.sessionId);
  if (msg instanceof Response) return msg;

  return Response.json(getMessage(msg.messageId));
}

/**
 * @openapi
 * /api/sessions/{id}/messages:
 *   post:
 *     tags: [Messages]
 *     summary: Add a message to a session
 *     operationId: addMessage
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [system, user, assistant, tool]
 *               content:
 *                 type: string
 *               client_turn_id:
 *                 type: string
 *               sender_type:
 *                 type: string
 *               image_paths:
 *                 type: array
 *                 items:
 *                   type: string
 *             required: [role, content]
 *     responses:
 *       '201':
 *         description: Message created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageRow'
 *       '400':
 *         description: Missing role or content.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Session not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export async function handleAddMessage(
  req: Request,
  params: RouteParams,
): Promise<Response> {
  const session = requireSession(params);
  if (session instanceof Response) return session;

  const parsed = await parseJsonBody<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    client_turn_id?: string;
    sender_type?: string;
    image_paths?: string[];
  }>(req);
  if (!parsed.ok) return parsed.response;

  const { role, content, client_turn_id, sender_type, image_paths } = parsed.value;
  if (!role || content === undefined) {
    return jsonError("role and content are required", 400);
  }

  const row = insertMessage({
    session_id: session.sessionId,
    role,
    content,
    client_turn_id,
    sender_type,
    image_paths,
  });

  pushSSEEvent(session.sessionId, "message_added", { id: row.id });
  pushSSEEvent(SESSIONS_CHANNEL, "session_updated", { session_id: session.sessionId });
  return Response.json(row, { status: 201 });
}

/**
 * @openapi
 * /api/sessions/{id}/messages/{messageId}:
 *   patch:
 *     tags: [Messages]
 *     summary: Update a message
 *     operationId: updateMessage
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID.
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *         description: Message ID (integer) or client_turn_id.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: string
 *               cancelled:
 *                 type: boolean
 *     responses:
 *       '200':
 *         description: Updated message.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageRow'
 *       '400':
 *         description: No fields to update or invalid messageId.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Session or message not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export async function handleUpdateMessage(
  req: Request,
  params: RouteParams,
): Promise<Response> {
  const session = requireSession(params);
  if (session instanceof Response) return session;

  const msg = requireMessage(params, session.sessionId);
  if (msg instanceof Response) return msg;

  const parsed = await parseJsonBody<{ content?: string; cancelled?: boolean }>(req);
  if (!parsed.ok) return parsed.response;

  const patch = parsed.value;
  if (patch.content === undefined && patch.cancelled === undefined) {
    return jsonError("No fields to update", 400);
  }

  const existing = getMessage(msg.messageId)!;
  updateMessage(msg.messageId, patch);
  pushSSEEvent(session.sessionId, "message_updated", {
    id: msg.messageId,
    content: patch.content ?? existing.content,
    cancelled: patch.cancelled ?? Boolean(existing.cancelled),
  });
  pushSSEEvent(SESSIONS_CHANNEL, "session_updated", { session_id: session.sessionId });

  const updated = getMessage(msg.messageId);
  return Response.json(updated);
}

/**
 * @openapi
 * /api/sessions/{id}/messages/{messageId}:
 *   delete:
 *     tags: [Messages]
 *     summary: Delete a message
 *     operationId: deleteMessage
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID.
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *         description: Message ID (integer) or client_turn_id.
 *     responses:
 *       '200':
 *         description: Message deleted.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deleted:
 *                   type: boolean
 *                 id:
 *                   type: integer
 *       '400':
 *         description: Invalid messageId.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Session or message not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal deletion failure.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export function handleDeleteMessage(
  _req: Request,
  params: RouteParams,
): Response {
  const session = requireSession(params);
  if (session instanceof Response) return session;

  const msg = requireMessage(params, session.sessionId);
  if (msg instanceof Response) return msg;

  const deleted = deleteMessage(msg.messageId, session.sessionId);
  if (!deleted) return jsonError("Failed to delete message", 500);

  pushSSEEvent(session.sessionId, "message_deleted", { id: msg.messageId });
  pushSSEEvent(SESSIONS_CHANNEL, "session_updated", { session_id: session.sessionId });
  return Response.json({ deleted: true, id: msg.messageId });
}
