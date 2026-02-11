/**
 * Chat Handler
 *
 * POST /api/chat — Unified streaming chat endpoint (chat + agent modes).
 * POST /api/chat/cancel — Cancel an in-flight request.
 *
 * Returns NDJSON stream with events: start, token, tool, complete, error, cancelled.
 */

import {
  getOrCreateSession,
  insertMessage,
  updateMessage,
  updateSession,
  validateExpectedVersion,
  getMessageByClientTurnId,
  getSession,
} from "../../../store/conversation-store.ts";
import { pushSSEEvent } from "../../../store/sse-store.ts";
import { ai } from "../../../api/ai.ts";
import { ensureAgentReady, runAgentQuery } from "../../../agent/agent-runner.ts";
import { DEFAULT_TOOL_DENYLIST } from "../../../agent/constants.ts";
import { getErrorMessage } from "../../../../common/utils.ts";
import { log } from "../../../api/log.ts";
import { parseJsonBody, jsonError, ndjsonLine } from "../http-utils.ts";
import type { Message } from "../../../providers/index.ts";
import { loadAllMessages } from "../../../store/message-utils.ts";
import type { Message as AgentMessage } from "../../../agent/context.ts";
import { getPlatform } from "../../../../platform/platform.ts";

// MARK: - Image Helpers

async function readImageAsBase64(filePath: string): Promise<string | null> {
  try {
    const data = await getPlatform().fs.readFile(filePath);
    const chunks: string[] = [];
    for (let i = 0; i < data.length; i += 8192) {
      chunks.push(String.fromCharCode(...data.subarray(i, Math.min(i + 8192, data.length))));
    }
    return btoa(chunks.join(""));
  } catch {
    return null;
  }
}

async function resolveImages(imagePathsJson: string | null): Promise<string[]> {
  if (!imagePathsJson) return [];
  try {
    const paths: string[] = JSON.parse(imagePathsJson);
    const images: string[] = [];
    for (const p of paths) {
      const base64 = await readImageAsBase64(p);
      if (base64) images.push(base64);
    }
    return images;
  } catch {
    return [];
  }
}

// MARK: - Types

interface ChatRequest {
  mode: "chat" | "agent";
  session_id: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    image_paths?: string[];
  }>;
  model?: string;
  temperature?: number;
  client_turn_id?: string;
  expected_version?: number;
}

interface CancelRequest {
  request_id: string;
}

// MARK: - Stored Properties

const activeRequests = new Map<string, { controller: AbortController; sessionId: string }>();
let agentReady = false;

export function isAgentReady(): boolean {
  return agentReady;
}

export function markAgentReady(): void {
  agentReady = true;
}

export function cancelSessionRequests(sessionId: string): void {
  for (const [requestId, entry] of activeRequests) {
    if (entry.sessionId === sessionId) {
      entry.controller.abort();
      activeRequests.delete(requestId);
    }
  }
}

export function handleSessionCancel(sessionId: string): Response {
  cancelSessionRequests(sessionId);
  return Response.json({ cancelled: true, session_id: sessionId });
}

// MARK: - Public Methods

export async function handleChat(req: Request): Promise<Response> {
  const requestId = req.headers.get("X-Request-ID") ?? crypto.randomUUID();

  const parsed = await parseJsonBody<ChatRequest>(req);
  if (!parsed.ok) return parsed.response;

  const body = parsed.value;
  if (!body.session_id || !body.messages?.length) {
    return jsonError("Missing session_id or messages", 400);
  }

  if (body.mode !== "chat" && body.mode !== "agent") {
    return jsonError("Invalid or missing mode: must be 'chat' or 'agent'", 400);
  }

  if (body.expected_version !== undefined) {
    if (!validateExpectedVersion(body.session_id, body.expected_version)) {
      return jsonError("Conflict: session has been modified", 409);
    }
  }

  if (body.client_turn_id) {
    const existing = getMessageByClientTurnId(body.session_id, body.client_turn_id);
    if (existing) {
      return Response.json(
        { event: "duplicate", request_id: requestId, message: existing },
        {
          status: 200,
          headers: { "X-Request-ID": requestId },
        },
      );
    }
  }

  if (body.model) {
    const modelInfo = await ai.models.get(body.model);
    if (modelInfo === null) {
      return jsonError(`Model not found: ${body.model}`, 400);
    }
    if (body.mode === "agent" && modelInfo.capabilities && !modelInfo.capabilities.includes("tools")) {
      return jsonError("Selected model does not support tool calling", 400);
    }
  } else if (body.mode === "agent") {
    const defaultModel = (await import("../../../../common/ai-default-model.ts")).getConfiguredModel();
    if (defaultModel) {
      const modelInfo = await ai.models.get(defaultModel);
      if (modelInfo && modelInfo.capabilities && !modelInfo.capabilities.includes("tools")) {
        return jsonError("Default model does not support tool calling", 400);
      }
    }
  }

  const encoder = new TextEncoder();
  const controller = new AbortController();
  activeRequests.set(requestId, { controller, sessionId: body.session_id });

  const sessionId = body.session_id;
  const session = getOrCreateSession(sessionId);

  for (const msg of body.messages) {
    const inserted = insertMessage({
      session_id: session.id,
      role: msg.role,
      content: msg.content,
      client_turn_id: msg.role === "user" ? body.client_turn_id : undefined,
      request_id: requestId,
      sender_type: msg.role === "user" ? "user" : "system",
      image_paths: msg.image_paths,
    });
    pushSSEEvent(session.id, "message_added", { message: inserted });
  }

  const senderType = body.mode === "agent" ? "agent" : "llm";
  const assistantMsg = insertMessage({
    session_id: session.id,
    role: "assistant",
    content: "",
    request_id: requestId,
    sender_type: senderType,
    sender_detail: body.model ?? "default",
  });
  const assistantMessageId = assistantMsg.id;
  pushSSEEvent(session.id, "message_added", { message: assistantMsg });

  let partialText = "";

  const stream = new ReadableStream({
    async start(streamController) {
      function emit(obj: unknown): void {
        try {
          streamController.enqueue(encoder.encode(ndjsonLine(obj)));
        } catch {
          // Stream closed
        }
      }

      try {
        emit({ event: "start", request_id: requestId });

        const onPartial = (text: string) => { partialText += text; };

        if (body.mode === "agent") {
          await handleAgentMode(body, assistantMessageId, controller.signal, emit, onPartial, requestId);
        } else {
          await handleChatMode(body, sessionId, assistantMessageId, controller.signal, emit, onPartial);
        }

        if (controller.signal.aborted) {
          updateMessage(assistantMessageId, { cancelled: true, content: partialText });
          pushSSEEvent(sessionId, "message_updated", {
            id: assistantMessageId,
            content: partialText,
            cancelled: true,
          });
          emit({ event: "cancelled", request_id: requestId, partial_text: partialText });
        } else {
          const currentSession = getSession(sessionId);
          if (currentSession && !currentSession.title) {
            const allMsgs = loadAllMessages(sessionId);
            const firstUserMsg = allMsgs.find(m => m.role === "user" && m.content.length > 0);
            if (firstUserMsg) {
              const autoTitle = firstUserMsg.content.slice(0, 60).replace(/\n/g, " ").trim();
              updateSession(sessionId, { title: autoTitle });
              pushSSEEvent(sessionId, "session_updated", { title: autoTitle });
            }
          }

          const updatedSession = getSession(sessionId);
          emit({
            event: "complete",
            request_id: requestId,
            session_version: updatedSession?.session_version ?? 0,
          });
        }
      } catch (error) {
        if (controller.signal.aborted) {
          updateMessage(assistantMessageId, { cancelled: true, content: partialText });
          pushSSEEvent(sessionId, "message_updated", {
            id: assistantMessageId,
            content: partialText,
            cancelled: true,
          });
          emit({ event: "cancelled", request_id: requestId, partial_text: partialText });
        } else {
          updateMessage(assistantMessageId, { cancelled: true, content: partialText });
          pushSSEEvent(sessionId, "message_updated", {
            id: assistantMessageId,
            content: partialText,
            cancelled: true,
          });
          emit({ event: "error", message: getErrorMessage(error) });
        }
      }

      streamController.close();
      activeRequests.delete(requestId);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Request-ID": requestId,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Request-ID, Last-Event-ID",
    },
  });
}

export async function handleChatCancel(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<CancelRequest>(req);
  if (!parsed.ok) return parsed.response;

  const { request_id } = parsed.value;
  if (!request_id) return jsonError("Missing request_id", 400);

  const entry = activeRequests.get(request_id);
  if (!entry) return jsonError("Request not found or already completed", 404);

  entry.controller.abort();
  return Response.json({ cancelled: true, request_id });
}

// MARK: - Chat Mode (Private Helpers)

async function handleChatMode(
  body: ChatRequest,
  sessionId: string,
  assistantMessageId: number,
  signal: AbortSignal,
  emit: (obj: unknown) => void,
  onPartial: (text: string) => void,
): Promise<void> {
  const storedMessages = loadAllMessages(sessionId);

  const providerMessages: Message[] = [];
  for (const m of storedMessages) {
    if (m.role === "tool" || m.cancelled || m.content.length === 0 || m.id === assistantMessageId) {
      continue;
    }
    const msg: Message = {
      role: m.role as Message["role"],
      content: m.content,
    };
    if (m.image_paths) {
      const images = await resolveImages(m.image_paths);
      if (images.length > 0) msg.images = images;
    }
    providerMessages.push(msg);
  }

  let fullText = "";

  for await (const token of ai.chat(providerMessages, {
    model: body.model,
    temperature: body.temperature,
    signal,
  })) {
    if (signal.aborted) break;
    fullText += token;
    onPartial(token);
    emit({ event: "token", text: token });
  }

  if (!signal.aborted) {
    updateMessage(assistantMessageId, { content: fullText });
    pushSSEEvent(sessionId, "message_updated", { id: assistantMessageId, content: fullText });
  }
}

async function handleAgentMode(
  body: ChatRequest,
  assistantMessageId: number,
  signal: AbortSignal,
  emit: (obj: unknown) => void,
  onPartial: (text: string) => void,
  requestId: string,
): Promise<void> {
  if (!agentReady) {
    const model = body.model ?? (await import("../../../../common/ai-default-model.ts")).getConfiguredModel();
    await ensureAgentReady(model, (msg) => log.info(msg));
    agentReady = true;
  }

  const stored = loadAllMessages(body.session_id);
  const history: AgentMessage[] = stored
    .filter((m) => !m.cancelled && m.content.length > 0 && m.id !== assistantMessageId)
    .map((m) => ({
      role: m.role as AgentMessage["role"],
      content: m.content,
      timestamp: new Date(m.created_at).getTime(),
      toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
      toolName: m.tool_name ?? undefined,
      toolCallId: m.tool_call_id ?? undefined,
    }));

  const lastUserMessage = [...body.messages].reverse().find((m) => m.role === "user");
  const query = lastUserMessage?.content ?? "";

  const result = await runAgentQuery({
    query,
    model: body.model,
    autoApprove: true,
    noInput: true,
    signal,
    toolDenylist: [...DEFAULT_TOOL_DENYLIST, "ask_user"],
    messageHistory: history,
    callbacks: {
      onToken: (text) => {
        onPartial(text);
        emit({ event: "token", text });
      },
      onToolDisplay: (event) => {
        const toolMsg = insertMessage({
          session_id: body.session_id,
          role: "tool",
          content: event.content ?? "",
          tool_name: event.toolName,
          sender_type: "agent",
          request_id: requestId,
        });
        pushSSEEvent(body.session_id, "message_added", { message: toolMsg });
        emit({
          event: "tool",
          name: event.toolName,
          success: event.success,
          content: event.content,
        });
      },
    },
  });

  if (!signal.aborted) {
    updateMessage(assistantMessageId, { content: result.text });
    pushSSEEvent(body.session_id, "message_updated", { id: assistantMessageId, content: result.text });
  }
}
