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
import { pushSSEEvent } from "../../../store/sse-store.ts";
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
  return Response.json(row, { status: 201 });
}

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

  const updated = getMessage(msg.messageId);
  return Response.json(updated);
}

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
  return Response.json({ deleted: true, id: msg.messageId });
}
