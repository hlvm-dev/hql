/**
 * Chat Handler
 *
 * POST /api/chat — Unified streaming chat endpoint (chat + agent modes).
 * POST /api/chat/cancel — Cancel an in-flight request.
 *
 * Returns NDJSON stream with events: start, token, tool, complete, error, cancelled.
 *
 * Split into modular files:
 * - chat-session.ts: request tracking, interaction handling, cancellation
 * - chat-agent-mode.ts: HLVM agent and Claude Code subprocess delegation
 * - chat-direct.ts: direct chat mode streaming, model validation
 */

import {
  getMessageByClientTurnId,
  getOrCreateSession,
  getSession,
  insertMessage,
  updateMessage,
  updateSession,
  validateExpectedVersion,
} from "../../../store/conversation-store.ts";
import { pushSSEEvent, SESSIONS_CHANNEL } from "../../../store/sse-store.ts";
import { autoConfigureInitialClaudeCodeModel } from "../../../../common/ai-default-model.ts";
import { getErrorMessage } from "../../../../common/utils.ts";
import { classifyError } from "../../../agent/error-taxonomy.ts";
import { log } from "../../../api/log.ts";
import {
  jsonError,
  ndjsonLine,
  parseJsonBody,
  textEncoder,
} from "../http-utils.ts";
import { parseModelString } from "../../../providers/index.ts";
import { loadRecentMessages } from "../../../store/message-utils.ts";
import { config } from "../../../api/config.ts";
import { ai } from "../../../api/ai.ts";
import { isPaidProvider, isProviderApproved } from "../../commands/ask.ts";
import { AGENT_MODEL_SUFFIX } from "../../../providers/claude-code/provider.ts";

// Re-exports from extracted modules (preserve external API)
export {
  type ChatRequest,
  type CancelRequest,
  type ChatMode,
  CLAUDE_CODE_AGENT_MODE,
  activeRequests,
  isAgentReady,
  markAgentReady,
  cancelSessionRequests,
  handleSessionCancel,
  handleChatInteraction,
  awaitInteractionResponse,
  emitCancellation,
  CHAT_CONTEXT_HISTORY_LIMIT,
  TITLE_SEARCH_HISTORY_LIMIT,
  AGENT_CONTEXT_HISTORY_LIMIT,
  pushSessionUpdatedEvent,
  getLastUserMessage,
} from "./chat-session.ts";

import {
  type ChatRequest,
  CLAUDE_CODE_AGENT_MODE,
  TITLE_SEARCH_HISTORY_LIMIT,
  activeRequests,
  emitCancellation,
  pushSessionUpdatedEvent,
} from "./chat-session.ts";
import { handleAgentMode, handleClaudeCodeAgentMode } from "./chat-agent-mode.ts";
import { handleChatMode, modelSupportsTools } from "./chat-direct.ts";

// ============================================================
// Types (re-exported from chat-session.ts above)
// ============================================================

interface CancelRequest {
  request_id: string;
}

// ============================================================
// Public Handlers
// ============================================================

/**
 * @openapi
 * /api/chat:
 *   post:
 *     tags: [Chat]
 *     summary: Streaming chat or agent request
 *     description: |
 *       Sends a message and streams the response as NDJSON.
 *       Supports chat, agent, and claude-code-agent modes.
 *       Each line is a JSON object with an `event` field.
 *     operationId: chat
 *     parameters:
 *       - in: header
 *         name: X-Request-ID
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Optional request ID for cancellation. Auto-generated if omitted.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatRequest'
 *     responses:
 *       '200':
 *         description: NDJSON event stream.
 *         headers:
 *           X-Request-ID:
 *             schema:
 *               type: string
 *         content:
 *           application/x-ndjson:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     event:
 *                       type: string
 *                       enum: [start]
 *                     request_id:
 *                       type: string
 *                 - type: object
 *                   properties:
 *                     event:
 *                       type: string
 *                       enum: [token]
 *                     text:
 *                       type: string
 *                 - type: object
 *                   properties:
 *                     event:
 *                       type: string
 *                       enum: [tool]
 *                     name:
 *                       type: string
 *                     success:
 *                       type: boolean
 *                     content:
 *                       type: string
 *                 - type: object
 *                   properties:
 *                     event:
 *                       type: string
 *                       enum: [complete]
 *                     request_id:
 *                       type: string
 *                     session_version:
 *                       type: integer
 *                 - type: object
 *                   properties:
 *                     event:
 *                       type: string
 *                       enum: [error]
 *                     message:
 *                       type: string
 *                 - type: object
 *                   properties:
 *                     event:
 *                       type: string
 *                       enum: [cancelled]
 *                     request_id:
 *                       type: string
 *                     partial_text:
 *                       type: string
 *         x-response-type: stream
 *       '400':
 *         description: Invalid request (missing fields, bad model, no tool support).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Paid provider not approved.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '409':
 *         description: Optimistic concurrency conflict.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export async function handleChat(req: Request): Promise<Response> {
  const requestId = req.headers.get("X-Request-ID") ?? crypto.randomUUID();

  const parsed = await parseJsonBody<ChatRequest>(req);
  if (!parsed.ok) return parsed.response;

  const body = parsed.value;
  if (!body.session_id || !body.messages?.length) {
    return jsonError("Missing session_id or messages", 400);
  }

  if (
    body.mode !== "chat" && body.mode !== "agent" &&
    body.mode !== CLAUDE_CODE_AGENT_MODE
  ) {
    return jsonError(
      `Invalid or missing mode: must be 'chat', 'agent', or '${CLAUDE_CODE_AGENT_MODE}'`,
      400,
    );
  }

  if (body.expected_version !== undefined) {
    if (!validateExpectedVersion(body.session_id, body.expected_version)) {
      return jsonError("Conflict: session has been modified", 409);
    }
  }

  if (body.client_turn_id) {
    const existing = getMessageByClientTurnId(
      body.session_id,
      body.client_turn_id,
    );
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

  let cfgSnapshot = config.snapshot;
  if (!body.model && !cfgSnapshot.modelConfigured) {
    await autoConfigureInitialClaudeCodeModel();
    cfgSnapshot = config.snapshot;
  }
  const resolvedModel = body.model ?? cfgSnapshot.model;

  if (
    (body.mode === "agent" || body.mode === CLAUDE_CODE_AGENT_MODE) &&
    !resolvedModel
  ) {
    return jsonError("No model configured for agent mode", 400);
  }

  let resolvedModelInfo: import("../../../providers/types.ts").ModelInfo | null = null;
  let modelDiscoveryFailed = false;
  if (resolvedModel) {
    const [parsedProvider, parsedModelName] = parseModelString(resolvedModel);
    try {
      resolvedModelInfo = await ai.models.get(
        parsedModelName,
        parsedProvider ?? undefined,
      );
    } catch {
      modelDiscoveryFailed = true;
    }
    if (body.model && resolvedModelInfo === null && !modelDiscoveryFailed) {
      return jsonError(`Model not found: ${body.model}`, 400);
    }
    if (
      (body.mode === "agent" || body.mode === CLAUDE_CODE_AGENT_MODE) &&
      resolvedModelInfo === null &&
      modelDiscoveryFailed
    ) {
      return jsonError(
        "Could not verify selected model capabilities for agent mode. Check provider connection and model availability.",
        503,
      );
    }
    if (body.mode === "agent") {
      const toolCheck = await modelSupportsTools(resolvedModel, resolvedModelInfo);
      if (!toolCheck.supported) {
        if (toolCheck.catalogFailed) {
          return jsonError(
            "Could not verify model tool support. Check provider connection and try again.",
            503,
          );
        }
        return jsonError(
          body.model
            ? "Selected model does not support tool calling"
            : "Default model does not support tool calling",
          400,
        );
      }
    }
  }

  if (
    resolvedModel && isPaidProvider(resolvedModel) &&
    !isProviderApproved(resolvedModel)
  ) {
    return jsonError(
      `Paid provider not approved. Run "hlvm ask --model ${resolvedModel}" in terminal first to grant consent.`,
      403,
    );
  }

  const controller = new AbortController();
  activeRequests.set(requestId, { controller, sessionId: body.session_id });

  const sessionId = body.session_id;
  const existingSession = getSession(sessionId);
  const session = getOrCreateSession(sessionId);
  if (!existingSession) {
    pushSSEEvent(SESSIONS_CHANNEL, "session_created", {
      session_id: session.id,
    });
  }

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
    pushSessionUpdatedEvent(session.id);
  }

  const senderType = body.mode === "agent"
    ? "agent"
    : body.mode === CLAUDE_CODE_AGENT_MODE
    ? "agent"
    : "llm";
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
  pushSessionUpdatedEvent(session.id);

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
        emitCancellation(
          assistantMessageId,
          partialText,
          sessionId,
          requestId,
          emit,
        );
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

        const onPartial = (text: string) => {
          partialText += text;
        };

        const isAgentModel = resolvedModel?.endsWith(AGENT_MODEL_SUFFIX) ??
          false;
        const configAgentMode = cfgSnapshot.agentMode;
        const effectiveMode = body.mode === CLAUDE_CODE_AGENT_MODE
          ? CLAUDE_CODE_AGENT_MODE
          : (body.mode === "agent" &&
              (isAgentModel || configAgentMode === "claude-code-agent"))
          ? CLAUDE_CODE_AGENT_MODE
          : body.mode;

        if (effectiveMode === CLAUDE_CODE_AGENT_MODE) {
          await handleClaudeCodeAgentMode(
            body,
            assistantMessageId,
            controller.signal,
            emit,
            onPartial,
          );
        } else if (effectiveMode === "agent") {
          await handleAgentMode(
            body,
            resolvedModel!,
            assistantMessageId,
            controller.signal,
            emit,
            onPartial,
            requestId,
            resolvedModelInfo,
          );
        } else {
          await handleChatMode(
            body,
            resolvedModel,
            sessionId,
            assistantMessageId,
            controller.signal,
            emit,
            onPartial,
          );
        }

        if (controller.signal.aborted) {
          emitCancellationOnce();
        } else {
          const currentSession = getSession(sessionId);
          if (currentSession && !currentSession.title) {
            const recentMsgs = loadRecentMessages(
              sessionId,
              TITLE_SEARCH_HISTORY_LIMIT,
            );
            const firstUserMsg = recentMsgs.find((m) =>
              m.role === "user" && m.content.length > 0
            );
            if (firstUserMsg) {
              const autoTitle = firstUserMsg.content.slice(0, 60).replace(
                /\n/g,
                " ",
              ).trim();
              updateSession(sessionId, { title: autoTitle });
              pushSSEEvent(sessionId, "session_updated", {
                session_id: sessionId,
                title: autoTitle,
              });
              pushSessionUpdatedEvent(sessionId);
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
          const errorMsg = getErrorMessage(error);
          const displayContent = partialText.length > 0
            ? `${partialText}\n\n[Error: ${errorMsg}]`
            : `Error: ${errorMsg}`;
          updateMessage(assistantMessageId, { content: displayContent });
          pushSSEEvent(sessionId, "message_updated", {
            id: assistantMessageId,
            content: displayContent,
          });
          pushSessionUpdatedEvent(sessionId);
          if (partialText.length === 0) {
            emit({ event: "token", text: `Error: ${errorMsg}` });
          }
          const classified = classifyError(error);
          emit({
            event: "error",
            message: errorMsg,
            errorClass: classified.class,
            retryable: classified.retryable,
          });
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

/**
 * @openapi
 * /api/chat/cancel:
 *   post:
 *     tags: [Chat]
 *     summary: Cancel an in-flight chat request
 *     operationId: cancelChat
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               request_id:
 *                 type: string
 *             required: [request_id]
 *     responses:
 *       '200':
 *         description: Request cancelled.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cancelled:
 *                   type: boolean
 *                 request_id:
 *                   type: string
 *       '400':
 *         description: Missing request_id.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Request not found or already completed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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
