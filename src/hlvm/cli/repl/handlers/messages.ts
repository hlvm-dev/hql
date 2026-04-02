/**
 * Messages Handler
 *
 * Paginated message retrieval and CRUD for active-conversation messages.
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
import { getActiveConversationSessionId } from "../../../store/active-conversation.ts";
import { pushSSEEvent } from "../../../store/sse-store.ts";
import { getRequiredAttachmentRecords } from "../../../attachments/service.ts";
import {
  toRuntimeSessionMessage,
  toRuntimeSessionMessagesResponse,
} from "../../../runtime/session-protocol.ts";
import type { RouteParams } from "../http-router.ts";
import { parseJsonBody, jsonError } from "../http-utils.ts";
import { pushConversationUpdatedEvent } from "./chat-session.ts";

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

async function validateAttachmentIds(
  attachmentIds: string[] | undefined,
): Promise<Response | undefined> {
  if (!attachmentIds) return undefined;
  if (!Array.isArray(attachmentIds)) {
    return jsonError("attachment_ids must be an array", 400);
  }
  if (attachmentIds.some((id) => typeof id !== "string" || id.length === 0)) {
    return jsonError("attachment_ids must contain non-empty strings", 400);
  }
  if (attachmentIds.length === 0) return undefined;

  try {
    await getRequiredAttachmentRecords(attachmentIds);
    return undefined;
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Attachment not found",
      400,
    );
  }
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
 * /api/chat/messages:
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
 *               $ref: '#/components/schemas/RuntimeSessionMessagesResponse'
 *       '404':
 *         description: Session not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export async function handleGetMessages(
  req: Request,
  params: RouteParams,
): Promise<Response> {
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
  return Response.json(await toRuntimeSessionMessagesResponse(result));
}

/**
 * @openapi
 * /api/chat/messages/{messageId}:
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
 *               $ref: '#/components/schemas/RuntimeSessionMessage'
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
export async function handleGetMessage(
  _req: Request,
  params: RouteParams,
): Promise<Response> {
  const session = requireSession(params);
  if (session instanceof Response) return session;

  const msg = requireMessage(params, session.sessionId);
  if (msg instanceof Response) return msg;

  return Response.json(await toRuntimeSessionMessage(getMessage(msg.messageId)!));
}

/**
 * @openapi
 * /api/chat/messages:
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
 *               display_content:
 *                 type: string
 *               client_turn_id:
 *                 type: string
 *               sender_type:
 *                 type: string
 *               attachment_ids:
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
 *               $ref: '#/components/schemas/RuntimeSessionMessage'
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
    display_content?: string;
    client_turn_id?: string;
    sender_type?: string;
    attachment_ids?: string[];
  }>(req);
  if (!parsed.ok) return parsed.response;

  const {
    role,
    content,
    display_content,
    client_turn_id,
    sender_type,
    attachment_ids,
  } = parsed.value;
  if (!role || content === undefined) {
    return jsonError("role and content are required", 400);
  }
  const attachmentValidationError = await validateAttachmentIds(attachment_ids);
  if (attachmentValidationError) {
    return attachmentValidationError;
  }

  const row = insertMessage({
    session_id: session.sessionId,
    role,
    content,
    display_content,
    client_turn_id,
    sender_type,
    attachment_ids,
  });

  pushSSEEvent(session.sessionId, "message_added", {
    message: await toRuntimeSessionMessage(row),
  });
  pushConversationUpdatedEvent(session.sessionId);
  return Response.json(await toRuntimeSessionMessage(row), { status: 201 });
}

/**
 * @openapi
 * /api/chat/messages/{messageId}:
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
 *               display_content:
 *                 type: string
 *                 nullable: true
 *               cancelled:
 *                 type: boolean
 *     responses:
 *       '200':
 *         description: Updated message.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RuntimeSessionMessage'
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

  const parsed = await parseJsonBody<{
    content?: string;
    display_content?: string | null;
    cancelled?: boolean;
  }>(req);
  if (!parsed.ok) return parsed.response;

  const patch = parsed.value;
  if (
    patch.content === undefined &&
    patch.display_content === undefined &&
    patch.cancelled === undefined
  ) {
    return jsonError("No fields to update", 400);
  }

  updateMessage(msg.messageId, patch);
  const updated = getMessage(msg.messageId);
  if (!updated) {
    return jsonError("Message not found", 404);
  }
  pushSSEEvent(session.sessionId, "message_updated", {
    message: await toRuntimeSessionMessage(updated),
  });
  pushConversationUpdatedEvent(session.sessionId);
  return Response.json(
    updated ? await toRuntimeSessionMessage(updated) : null,
  );
}

/**
 * @openapi
 * /api/chat/messages/{messageId}:
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
  pushConversationUpdatedEvent(session.sessionId);
  return Response.json({ deleted: true, id: msg.messageId });
}

export function handleGetActiveMessages(
  req: Request,
): Promise<Response> {
  return handleGetMessages(req, {
    id: getActiveConversationSessionId(),
  });
}

export function handleGetActiveMessage(
  req: Request,
  params: RouteParams,
): Promise<Response> {
  return handleGetMessage(req, {
    id: getActiveConversationSessionId(),
    messageId: params.messageId,
  });
}

export function handleAddActiveMessage(
  req: Request,
): Promise<Response> {
  return handleAddMessage(req, {
    id: getActiveConversationSessionId(),
  });
}

export function handleUpdateActiveMessage(
  req: Request,
  params: RouteParams,
): Promise<Response> {
  return handleUpdateMessage(req, {
    id: getActiveConversationSessionId(),
    messageId: params.messageId,
  });
}

export function handleDeleteActiveMessage(
  req: Request,
  params: RouteParams,
): Response {
  return handleDeleteMessage(req, {
    id: getActiveConversationSessionId(),
    messageId: params.messageId,
  });
}
