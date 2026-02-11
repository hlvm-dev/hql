/**
 * Messages Handler
 *
 * Paginated message retrieval and CRUD for session messages.
 */

import {
  getMessages,
  getMessage,
  getSession,
  updateMessage,
  deleteMessage,
} from "../../../store/conversation-store.ts";
import { pushSSEEvent } from "../../../store/sse-store.ts";
import type { RouteParams } from "../http-router.ts";
import { parseJsonBody, jsonError } from "../http-utils.ts";

export function handleGetMessages(
  req: Request,
  params: RouteParams,
): Response {
  const sessionId = params.id;
  const session = getSession(sessionId);
  if (!session) return jsonError("Session not found", 404);

  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
  const sort = url.searchParams.get("sort") === "asc" ? "asc" as const : "desc" as const;
  const afterOrderRaw = url.searchParams.get("after_order");
  const afterOrder = afterOrderRaw ? parseInt(afterOrderRaw, 10) : undefined;

  const result = getMessages(sessionId, {
    limit: isNaN(limit) ? 50 : limit,
    offset: isNaN(offset) ? 0 : offset,
    sort,
    after_order: afterOrder !== undefined && !isNaN(afterOrder) ? afterOrder : undefined,
  });

  return Response.json(result);
}

export function handleGetMessage(
  _req: Request,
  params: RouteParams,
): Response {
  const sessionId = params.id;
  const session = getSession(sessionId);
  if (!session) return jsonError("Session not found", 404);

  const messageId = parseInt(params.messageId, 10);
  if (isNaN(messageId)) return jsonError("Invalid message ID", 400);

  const message = getMessage(messageId);
  if (!message || message.session_id !== sessionId) {
    return jsonError("Message not found", 404);
  }

  return Response.json(message);
}

export async function handleUpdateMessage(
  req: Request,
  params: RouteParams,
): Promise<Response> {
  const sessionId = params.id;
  const session = getSession(sessionId);
  if (!session) return jsonError("Session not found", 404);

  const messageId = parseInt(params.messageId, 10);
  if (isNaN(messageId)) return jsonError("Invalid message ID", 400);

  const existing = getMessage(messageId);
  if (!existing || existing.session_id !== sessionId) {
    return jsonError("Message not found", 404);
  }

  const parsed = await parseJsonBody<{ content?: string; cancelled?: boolean }>(req);
  if (!parsed.ok) return parsed.response;

  const patch = parsed.value;
  if (patch.content === undefined && patch.cancelled === undefined) {
    return jsonError("No fields to update", 400);
  }

  updateMessage(messageId, patch);
  pushSSEEvent(sessionId, "message_updated", {
    id: messageId,
    content: patch.content ?? existing.content,
    cancelled: patch.cancelled ?? Boolean(existing.cancelled),
  });

  const updated = getMessage(messageId);
  return Response.json(updated);
}

export function handleDeleteMessage(
  _req: Request,
  params: RouteParams,
): Response {
  const sessionId = params.id;
  const session = getSession(sessionId);
  if (!session) return jsonError("Session not found", 404);

  const messageId = parseInt(params.messageId, 10);
  if (isNaN(messageId)) return jsonError("Invalid message ID", 400);

  const existing = getMessage(messageId);
  if (!existing || existing.session_id !== sessionId) {
    return jsonError("Message not found", 404);
  }

  const deleted = deleteMessage(messageId, sessionId);
  if (!deleted) return jsonError("Failed to delete message", 500);

  pushSSEEvent(sessionId, "message_deleted", { id: messageId });
  return Response.json({ deleted: true, id: messageId });
}
