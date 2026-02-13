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
import { parseJsonBody, jsonError, ndjsonLine, textEncoder } from "../http-utils.ts";
import { type Message, parseModelString } from "../../../providers/index.ts";
import { loadAllMessages } from "../../../store/message-utils.ts";
import type { Message as AgentMessage } from "../../../agent/context.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import type { ModelInfo } from "../../../providers/types.ts";
import { isPaidProvider, isProviderApproved } from "../../commands/ask.ts";

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

// MARK: - Model Validation

async function modelSupportsTools(modelName: string, modelInfo: ModelInfo | null): Promise<boolean> {
  if (modelInfo?.capabilities) {
    return modelInfo.capabilities.includes("tools");
  }
  try {
    const catalog = await ai.models.catalog();
    const bare = modelName.includes("/") ? modelName.slice(modelName.indexOf("/") + 1) : modelName;
    const baseName = bare.split(":")[0];
    const match = catalog.find((m) =>
      m.name === bare || m.name.split(":")[0] === baseName
    );
    if (match) {
      return match.capabilities?.includes("tools") ?? false;
    }
  } catch {
    // Catalog unavailable
  }
  return true;
}

// MARK: - Types

interface ChatRequest {
  mode: "chat" | "agent";
  session_id: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    image_paths?: string[];
    client_turn_id?: string;
  }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  client_turn_id?: string;
  assistant_client_turn_id?: string;
  expected_version?: number;
}

interface CancelRequest {
  request_id: string;
}

// MARK: - Stored Properties

const activeRequests = new Map<string, {
  controller: AbortController;
  sessionId: string;
  cancel?: () => void;
}>();
let agentReady = false;

export function isAgentReady(): boolean {
  return agentReady;
}

export function markAgentReady(): void {
  agentReady = true;
}

export function cancelSessionRequests(sessionId: string): number {
  let count = 0;
  for (const [requestId, entry] of activeRequests) {
    if (entry.sessionId !== sessionId) continue;

    if (entry.cancel) {
      entry.cancel();
    } else {
      entry.controller.abort();
    }

    activeRequests.delete(requestId);
    count++;
  }
  return count;
}

export function handleSessionCancel(sessionId: string): Response {
  const count = cancelSessionRequests(sessionId);
  return Response.json({ cancelled: count > 0, session_id: sessionId, cancelled_count: count });
}

// MARK: - Private Helpers

function emitCancellation(
  assistantMessageId: number,
  partialText: string,
  sessionId: string,
  requestId: string,
  emit: (obj: unknown) => void,
): void {
  updateMessage(assistantMessageId, { cancelled: true, content: partialText });
  pushSSEEvent(sessionId, "message_updated", {
    id: assistantMessageId,
    content: partialText,
    cancelled: true,
  });
  emit({ event: "cancelled", request_id: requestId, partial_text: partialText });
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

  const resolvedModel = body.model ??
    (body.mode === "agent" ? (await import("../../../../common/ai-default-model.ts")).getConfiguredModel() : undefined);

  if (body.mode === "agent" && !resolvedModel) {
    return jsonError("No model configured for agent mode", 400);
  }

  if (resolvedModel) {
    const [parsedProvider, parsedModelName] = parseModelString(resolvedModel);
    const modelInfo = await ai.models.get(parsedModelName, parsedProvider ?? undefined);
    if (body.model && modelInfo === null) {
      return jsonError(`Model not found: ${body.model}`, 400);
    }
    if (body.mode === "agent" && !(await modelSupportsTools(resolvedModel, modelInfo))) {
      return jsonError(
        body.model
          ? "Selected model does not support tool calling"
          : "Default model does not support tool calling",
        400,
      );
    }
  }

  if (resolvedModel && isPaidProvider(resolvedModel) && !isProviderApproved(resolvedModel)) {
    return jsonError(
      `Paid provider not approved. Run "hlvm ask --model ${resolvedModel}" in terminal first to grant consent.`,
      403,
    );
  }

  const controller = new AbortController();
  activeRequests.set(requestId, { controller, sessionId: body.session_id });

  const sessionId = body.session_id;
  const session = getOrCreateSession(sessionId);

  const currentMsg = body.messages[body.messages.length - 1];
  if (currentMsg && currentMsg.role !== "system") {
    const turnId = currentMsg.client_turn_id ?? body.client_turn_id;
    const inserted = insertMessage({
      session_id: session.id,
      role: currentMsg.role,
      content: currentMsg.content,
      client_turn_id: turnId,
      request_id: requestId,
      sender_type: currentMsg.role === "user" ? "user" : "system",
      image_paths: currentMsg.image_paths,
    });
    pushSSEEvent(session.id, "message_added", { message: inserted });
  }

  const senderType = body.mode === "agent" ? "agent" : "llm";
  const assistantMsg = insertMessage({
    session_id: session.id,
    role: "assistant",
    content: "",
    client_turn_id: body.assistant_client_turn_id,
    request_id: requestId,
    sender_type: senderType,
    sender_detail: resolvedModel ?? "default",
  });
  const assistantMessageId = assistantMsg.id;
  pushSSEEvent(session.id, "message_added", { message: assistantMsg });

  let partialText = "";
  let cancellationEmitted = false;

  const stream = new ReadableStream({
    async start(streamController) {
      function emit(obj: unknown): void {
        try {
          streamController.enqueue(textEncoder.encode(ndjsonLine(obj)));
        } catch {
          // Stream closed
        }
      }

      const emitCancellationOnce = () => {
        if (cancellationEmitted) return;
        cancellationEmitted = true;
        emitCancellation(assistantMessageId, partialText, sessionId, requestId, emit);
      };

      const activeEntry = activeRequests.get(requestId);
      if (activeEntry) {
        activeEntry.cancel = () => {
          if (!controller.signal.aborted) {
            controller.abort();
          }
          emitCancellationOnce();
          try {
            streamController.close();
          } catch {
            // Stream already closed
          }
        };
      }

      try {
        emit({ event: "start", request_id: requestId });

        const onPartial = (text: string) => { partialText += text; };

        if (body.mode === "agent") {
          await handleAgentMode(body, resolvedModel!, assistantMessageId, controller.signal, emit, onPartial, requestId);
        } else {
          await handleChatMode(body, sessionId, assistantMessageId, controller.signal, emit, onPartial);
        }

        if (controller.signal.aborted) {
          emitCancellationOnce();
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
          emitCancellationOnce();
        } else {
          // Preserve partial output for UI/state recovery, but don't mark as cancelled on real errors.
          if (partialText.length > 0) {
            updateMessage(assistantMessageId, { content: partialText });
            pushSSEEvent(sessionId, "message_updated", {
              id: assistantMessageId,
              content: partialText,
            });
          }
          emit({ event: "error", message: getErrorMessage(error) });
        }
      }

      try {
        streamController.close();
      } catch {
        // Stream already closed
      }
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

  if (entry.cancel) {
    entry.cancel();
  } else {
    entry.controller.abort();
  }

  activeRequests.delete(request_id);
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

  const tokenIterator = ai.chat(providerMessages, {
    model: body.model,
    temperature: body.temperature,
    maxTokens: body.max_tokens,
    signal,
  })[Symbol.asyncIterator]();

  const waitForAbort: Promise<"aborted"> = signal.aborted
    ? Promise.resolve("aborted")
    : new Promise((resolve) => {
      signal.addEventListener("abort", () => resolve("aborted"), { once: true });
    });

  while (true) {
    if (signal.aborted) {
      try {
        await tokenIterator.return?.();
      } catch {
        // iterator already closed
      }
      break;
    }

    const nextPromise = tokenIterator.next();
    const nextOrAbort = await Promise.race([
      nextPromise.then((result) => ({ type: "next" as const, result })),
      waitForAbort.then(() => ({ type: "abort" as const })),
    ]);

    if (nextOrAbort.type === "abort") {
      nextPromise.catch(() => {});
      try {
        await tokenIterator.return?.();
      } catch {
        // iterator already closed
      }
      break;
    }

    if (nextOrAbort.result.done) {
      break;
    }

    const token = nextOrAbort.result.value;
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
  resolvedModel: string,
  assistantMessageId: number,
  signal: AbortSignal,
  emit: (obj: unknown) => void,
  onPartial: (text: string) => void,
  requestId: string,
): Promise<void> {
  if (!agentReady) {
    await ensureAgentReady(resolvedModel, (msg) => log.info(msg));
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
    model: resolvedModel,
    autoApprove: false,
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
