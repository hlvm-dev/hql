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
  getMessage,
  getMessageByClientTurnId,
  getOrCreateSession,
  getSession,
  insertMessage,
  updateMessage,
  updateSession,
  validateExpectedVersion,
} from "../../../store/conversation-store.ts";
import { resolveConversationSessionId } from "../../../store/active-conversation.ts";
import { pushSSEEvent } from "../../../store/sse-store.ts";
import {
  ensureInitialModelConfigured,
} from "../../../../common/ai-default-model.ts";
import { AUTO_MODEL_ID, DEFAULT_MODEL_ID } from "../../../../common/config/types.ts";
import { describeErrorForDisplay } from "../../../agent/error-taxonomy.ts";
import {
  jsonError,
  ndjsonLine,
  parseJsonBody,
  textEncoder,
} from "../http-utils.ts";
import type { AnyAttachment } from "../attachment.ts";
import {
  getPastedTextPreviewLabel,
  getPastedTextReferenceLineCount,
} from "../attachment.ts";
import { evaluate } from "../evaluator.ts";
import { formatPlainValue } from "../formatter.ts";
import { ensureRuntimeHostReplState } from "../init-repl-state.ts";
import { parseModelString } from "../../../providers/index.ts";
import {
  loadAllMessages,
  loadRecentMessages,
} from "../../../store/message-utils.ts";
import { config } from "../../../api/config.ts";
import { ai } from "../../../api/ai.ts";
import { log } from "../../../api/log.ts";
import {
  persistConversationFacts,
  persistExplicitMemoryRequest,
} from "../../../memory/mod.ts";
import { getErrorMessage } from "../../../../common/utils.ts";
import { recordPromptHistory } from "../prompt-history.ts";

import { AGENT_MODEL_SUFFIX } from "../../../providers/claude-code/provider.ts";
import { evaluateProviderApproval } from "../../../providers/approval.ts";
import { supportsAgentExecution } from "../../../agent/constants.ts";

export { handleChatInteraction } from "./chat-session.ts";

import {
  activeRequests,
  type CancelRequest,
  type ChatRequest,
  CLAUDE_CODE_AGENT_MODE,
  emitCancellation,
  getLastUserMessage,
  pushConversationUpdatedEvent,
  TITLE_SEARCH_HISTORY_LIMIT,
} from "./chat-session.ts";
import {
  handleAgentMode,
  handleClaudeCodeAgentMode,
} from "./chat-agent-mode.ts";
import { handleChatMode } from "./chat-direct.ts";
import {
  buildRequestMessagesToPersist,
  shouldHonorRequestMessages,
  validateChatRequestMessages,
} from "./chat-context.ts";
import { modelSupportsTools } from "../../model-capabilities.ts";
import {
  checkModelAttachmentIds,
  describeAttachmentFailure,
} from "../../attachment-policy.ts";
import {
  appendAttachmentPipelineTrace,
  getRequiredAttachmentRecords,
  materializeConversationAttachment,
} from "../../../attachments/service.ts";
import { toRuntimeSessionMessage } from "../../../runtime/session-protocol.ts";
import {
  buildTraceTextPreview,
  traceReplMainThreadForSource,
} from "../../../repl-main-thread-trace.ts";

function requestHasMediaAttachments(
  messages: ChatRequest["messages"],
): boolean {
  return messages.some((message) => (message.attachment_ids?.length ?? 0) > 0);
}

function getRequestAttachmentIds(
  messages: ChatRequest["messages"],
): string[] {
  return messages.flatMap((message) => message.attachment_ids ?? []);
}

function hasDeprecatedSessionIdField(body: ChatRequest): boolean {
  return Object.prototype.hasOwnProperty.call(
    body as unknown as object,
    "session_id",
  );
}

function validateCapturedContexts(
  capturedContexts: ChatRequest["captured_contexts"],
): string | null {
  if (capturedContexts === undefined) return null;
  if (!Array.isArray(capturedContexts)) {
    return "captured_contexts must be an array";
  }

  for (const context of capturedContexts) {
    if (!context || typeof context !== "object" || Array.isArray(context)) {
      return "captured_contexts entries must be objects";
    }
    if (typeof context.source !== "string" || context.source.trim().length === 0) {
      return "captured_contexts.source must be a non-empty string";
    }
    if (typeof context.name !== "string" || context.name.trim().length === 0) {
      return "captured_contexts.name must be a non-empty string";
    }
    if (
      context.detail !== undefined && context.detail !== null &&
      typeof context.detail !== "string"
    ) {
      return "captured_contexts.detail must be a string when provided";
    }

    if (context.metadata !== undefined) {
      if (
        !context.metadata || typeof context.metadata !== "object" ||
        Array.isArray(context.metadata)
      ) {
        return "captured_contexts.metadata must be an object";
      }
      for (const value of Object.values(context.metadata)) {
        if (typeof value !== "string") {
          return "captured_contexts.metadata values must be strings";
        }
      }
    }
  }

  return null;
}

function isChatMode(value: unknown): value is NonNullable<ChatRequest["mode"]> {
  return value === "chat" || value === "eval" || value === "agent" ||
    value === CLAUDE_CODE_AGENT_MODE;
}

function requestWantsBinaryAgentMode(body: ChatRequest): boolean {
  return body.response_schema !== undefined ||
    body.tool_allowlist !== undefined ||
    body.tool_denylist !== undefined ||
    body.max_iterations !== undefined ||
    body.max_budget_usd !== undefined ||
    body.computer_use === true;
}

function resolveRequestedMode(body: ChatRequest): NonNullable<ChatRequest["mode"]> {
  if (body.mode && isChatMode(body.mode)) {
    return body.mode;
  }
  return requestWantsBinaryAgentMode(body) ? "agent" : "chat";
}

export async function buildEvalAttachments(
  attachmentIds: readonly string[],
): Promise<AnyAttachment[] | undefined> {
  if (attachmentIds.length === 0) {
    return undefined;
  }

  const records = await getRequiredAttachmentRecords(attachmentIds);

  const attachments = await Promise.all(
    records.map(async (record, index) => {
      const materialized = await materializeConversationAttachment(
        record.id,
        "repl",
      );
      if (materialized.mode === "text") {
        return {
          id: index + 1,
          attachmentId: record.id,
          type: "text" as const,
          displayName: getPastedTextPreviewLabel(index + 1, materialized.text),
          content: materialized.text,
          lineCount: getPastedTextReferenceLineCount(materialized.text),
          size: materialized.size,
          fileName: materialized.fileName,
          mimeType: materialized.mimeType,
        };
      }
      return {
        id: index + 1,
        attachmentId: record.id,
        type: record.kind,
        displayName: record.fileName,
        path: record.sourcePath ?? record.fileName,
        fileName: record.fileName,
        mimeType: record.mimeType,
        size: record.size,
        metadata: record.metadata,
      };
    }),
  );
  return attachments;
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
 *       Request `messages` are used as authoritative prompt history when the
 *       client provides explicit multi-message or non-user context. Single-turn
 *       user requests fall back to the persisted session transcript.
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
  if (!body.messages?.length) {
    return jsonError("Missing messages", 400);
  }
  if (hasDeprecatedSessionIdField(body)) {
    log.warn(
      "Deprecated /api/chat session_id was ignored. Use the active conversation or stateless:true instead.",
    );
  }
  const sessionId = resolveConversationSessionId(undefined, {
    stateless: body.stateless === true,
  });
  traceReplMainThreadForSource(body.query_source, "server.chat.request", {
    requestId,
    sessionId,
    mode: body.mode ?? "auto",
    stateless: body.stateless === true,
    messageCount: body.messages.length,
    queryPreview: buildTraceTextPreview(
      getLastUserMessage(body.messages)?.content,
    ),
  });

  const requestValidationError = validateChatRequestMessages(body.messages);
  if (requestValidationError) {
    return jsonError(requestValidationError, 400);
  }
  const capturedContextValidationError = validateCapturedContexts(
    body.captured_contexts,
  );
  if (capturedContextValidationError) {
    return jsonError(capturedContextValidationError, 400);
  }

  const currentUserMessage = getLastUserMessage(body.messages)!;
  const currentTurnId = currentUserMessage.client_turn_id ??
    body.client_turn_id;

  if (body.mode !== undefined && !isChatMode(body.mode)) {
    return jsonError(
      `Invalid mode: must be 'chat', 'eval', 'agent', or '${CLAUDE_CODE_AGENT_MODE}'`,
      400,
    );
  }
  const requestedMode = resolveRequestedMode(body);
  const isEvalMode = requestedMode === "eval";
  if (isEvalMode) {
    try {
      await getRequiredAttachmentRecords(
        getRequestAttachmentIds(body.messages),
      );
    } catch (error) {
      return jsonError(
        error instanceof Error ? error.message : "Attachment not found",
        400,
      );
    }
  }
  if (body.response_schema !== undefined) {
    if (
      !body.response_schema ||
      typeof body.response_schema !== "object" ||
      Array.isArray(body.response_schema)
    ) {
      return jsonError("response_schema must be a JSON object", 400);
    }
    if (requestedMode !== "agent") {
      return jsonError(
        "response_schema is supported only for mode:'agent' in this phase",
        400,
      );
    }
  }

  if (body.expected_version !== undefined) {
    if (!validateExpectedVersion(sessionId, body.expected_version)) {
      return jsonError("Conflict: session has been modified", 409);
    }
  }

  if (currentTurnId) {
    const existing = getMessageByClientTurnId(
      sessionId,
      currentTurnId,
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

  let resolvedModel = isEvalMode
    ? undefined
    : body.model ?? (await ensureInitialModelConfigured()).model;
  const requestAttachmentIds = getRequestAttachmentIds(body.messages);
  traceReplMainThreadForSource(body.query_source, "server.chat.model_ready", {
    requestId,
    sessionId,
    model: resolvedModel ?? null,
    attachmentCount: requestAttachmentIds.length,
  });
  if (requestAttachmentIds.length > 0) {
    await appendAttachmentPipelineTrace({
      stage: "chat_requested",
      attachmentIds: requestAttachmentIds,
      attachmentCount: requestAttachmentIds.length,
      sessionId,
      clientTurnId: currentTurnId,
      requestMode: requestedMode,
      model: resolvedModel,
    });
  }
  const cfgSnapshot = config.snapshot;
  const fixturePath = typeof body.fixture_path === "string" &&
      body.fixture_path.trim()
    ? body.fixture_path.trim()
    : undefined;

  if (
    !isEvalMode &&
    (requestedMode === "agent" || requestedMode === CLAUDE_CODE_AGENT_MODE) &&
    !resolvedModel
  ) {
    // Guaranteed local default is always available — use it as last resort
    resolvedModel = DEFAULT_MODEL_ID;
  }

  let resolvedModelInfo:
    | import("../../../providers/types.ts").ModelInfo
    | null = null;
  let modelDiscoveryFailed = false;
  let modelDiscoveryError: string | null = null;
  const hasMediaAttachments = requestHasMediaAttachments(body.messages);
  const isAutoSelect = resolvedModel === AUTO_MODEL_ID;
  if (resolvedModel && !fixturePath && !isAutoSelect) {
    const [parsedProvider, parsedModelName] = parseModelString(resolvedModel);
    try {
      resolvedModelInfo = await ai.models.get(
        parsedModelName,
        parsedProvider ?? undefined,
      );
    } catch (error) {
      modelDiscoveryFailed = true;
      modelDiscoveryError = getErrorMessage(error);
    }
    if (resolvedModelInfo === null && !modelDiscoveryFailed) {
      // Configured model not found — fall back to guaranteed local default
      if (resolvedModel !== DEFAULT_MODEL_ID) {
        const [defProvider, defModelName] = parseModelString(DEFAULT_MODEL_ID);
        try {
          resolvedModelInfo = await ai.models.get(
            defModelName,
            defProvider ?? undefined,
          );
          if (resolvedModelInfo) {
            resolvedModel = DEFAULT_MODEL_ID;
          }
        } catch { /* modelDiscoveryFailed stays false, fallback continues */ }
      }
      // Only error if both the configured model AND the default are missing
      if (resolvedModelInfo === null) {
        return jsonError(
          `Model not found: ${body.model ?? resolvedModel}. Default model (${DEFAULT_MODEL_ID}) also unavailable.`,
          400,
        );
      }
    }
    if (
      (requestedMode === "agent" || requestedMode === CLAUDE_CODE_AGENT_MODE) &&
      resolvedModelInfo === null &&
      modelDiscoveryFailed
    ) {
      // Discovery failed for configured model — try guaranteed local default
      if (resolvedModel !== DEFAULT_MODEL_ID) {
        const [defProvider, defModelName] = parseModelString(DEFAULT_MODEL_ID);
        try {
          const fallbackInfo = await ai.models.get(
            defModelName,
            defProvider ?? undefined,
          );
          if (fallbackInfo) {
            resolvedModelInfo = fallbackInfo;
            resolvedModel = DEFAULT_MODEL_ID;
            modelDiscoveryFailed = false;
          }
        } catch { /* default also unreachable — fall through to error */ }
      }
      if (resolvedModelInfo === null) {
        return jsonError(
          modelDiscoveryError ??
            "Could not verify selected model capabilities for agent mode. Check provider connection and model availability.",
          503,
        );
      }
    }
    if (hasMediaAttachments) {
      const attachmentSupport = await checkModelAttachmentIds(
        resolvedModel,
        getRequestAttachmentIds(body.messages),
        resolvedModelInfo,
      );
      if (!attachmentSupport.supported) {
        if (attachmentSupport.catalogFailed) {
          return jsonError(
            "Could not verify model attachment support. Check provider connection and try again.",
            503,
          );
        }
        return jsonError(
          describeAttachmentFailure(attachmentSupport, resolvedModel) ||
            (body.model
              ? "Selected model does not support these attachments"
              : "Default model does not support these attachments"),
          400,
        );
      }
    }
    if (requestedMode === "agent") {
      const toolCheck = await modelSupportsTools(
        resolvedModel,
        resolvedModelInfo,
      );
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
    !isEvalMode &&
    !fixturePath &&
    resolvedModel &&
    !isAutoSelect &&
    evaluateProviderApproval(resolvedModel, config.snapshot.approvedProviders)
        .status === "approval_required"
  ) {
    return jsonError(
      `Paid provider not approved. Run "hlvm ask --model ${resolvedModel}" in terminal first to grant consent.`,
      403,
    );
  }

  const controller = new AbortController();
  activeRequests.set(requestId, { controller, sessionId });
  const session = getOrCreateSession(sessionId);
  const preTurnSessionVersion = session.session_version;

  const persistedRequestMessages = buildRequestMessagesToPersist({
    requestMessages: body.messages,
    storedMessages: shouldHonorRequestMessages(body.messages)
      ? loadAllMessages(sessionId)
      : [],
    fallbackClientTurnId: body.client_turn_id,
  });
  for (const message of persistedRequestMessages) {
    const inserted = insertMessage({
      session_id: session.id,
      role: message.role,
      content: message.content,
      display_content: message.displayContent ?? null,
      client_turn_id: message.clientTurnId,
      request_id: requestId,
      sender_type: isEvalMode && message.role !== "system"
        ? "eval"
        : message.senderType,
      attachment_ids: message.attachmentIds,
    });
    pushSSEEvent(session.id, "message_added", {
      message: await toRuntimeSessionMessage(inserted),
    });
    pushConversationUpdatedEvent(session.id);
  }

  if (!isEvalMode && !body.stateless) {
    try {
      const replState = await ensureRuntimeHostReplState();
      recordPromptHistory(
        replState,
        currentUserMessage.content,
        "conversation",
      );
    } catch (error) {
      log.warn("Failed to record prompt history", error);
    }
  }

  const senderType = requestedMode === "agent"
    ? "agent"
    : requestedMode === "eval"
    ? "eval"
    : requestedMode === CLAUDE_CODE_AGENT_MODE
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
  pushSSEEvent(session.id, "message_added", {
    message: await toRuntimeSessionMessage(assistantMsg),
  });
  pushConversationUpdatedEvent(session.id);

  let partialText = "";
  let cancellationEmitted = false;
  let resultStats:
    | import("../../../runtime/chat-protocol.ts").ChatResultStats
    | null = null;

  const stream = new ReadableStream({
    async start(streamController) {
      let streamClosed = false;
      function emit(obj: unknown): void {
        if (streamClosed) return;
        try {
          streamController.enqueue(textEncoder.encode(ndjsonLine(obj)));
        } catch {
          streamClosed = true;
        }
      }

      const emitCancellationOnce = async () => {
        if (cancellationEmitted) return;
        cancellationEmitted = true;
        traceReplMainThreadForSource(
          body.query_source,
          "server.chat.cancelled",
          {
            requestId,
            sessionId,
            partialTextChars: partialText.length,
          },
        );
        try {
          await emitCancellation(
            assistantMessageId,
            partialText,
            sessionId,
            requestId,
            emit,
          );
        } catch (error) {
          log.warn("Failed to emit chat cancellation state", error);
        }
      };

      const emitErrorState = async (error: unknown): Promise<void> => {
        const described = await describeErrorForDisplay(error);
        const errorMsg = described.message;
        traceReplMainThreadForSource(body.query_source, "server.chat.error", {
          requestId,
          sessionId,
          error: errorMsg,
          errorClass: described.class,
          retryable: described.retryable,
          partialTextChars: partialText.length,
        });
        const displayContent = partialText.length > 0
          ? `${partialText}\n\n[Error: ${errorMsg}]`
          : `Error: ${errorMsg}`;

        try {
          updateMessage(assistantMessageId, { content: displayContent });
        } catch (updateError) {
          log.warn("Failed to persist chat error message", updateError);
        }

        try {
          const updatedAssistant = getMessage(assistantMessageId);
          pushSSEEvent(sessionId, "message_updated", {
            message: updatedAssistant
              ? await toRuntimeSessionMessage(updatedAssistant)
              : {
                id: assistantMessageId,
                content: displayContent,
              },
          });
          pushConversationUpdatedEvent(sessionId);
        } catch (pushError) {
          log.warn("Failed to publish chat error update", pushError);
        }

        if (partialText.length === 0) {
          emit({ event: "token", text: `Error: ${errorMsg}` });
        }

        emit({
          event: "error",
          message: errorMsg,
          errorClass: described.class,
          retryable: described.retryable,
        });
      };

      const activeEntry = activeRequests.get(requestId);
      if (activeEntry) {
        activeEntry.cancel = () => {
          if (!controller.signal.aborted) {
            controller.abort();
          }
          void emitCancellationOnce();
          try {
            streamController.close();
          } catch {
            // Stream already closed
          }
        };
      }

      // Best-effort keepalive for long-running agent operations with sparse output.
      const heartbeatInterval = setInterval(
        () => emit({ event: "heartbeat" }),
        15_000,
      );

      try {
        emit({ event: "start", request_id: requestId });
        traceReplMainThreadForSource(
          body.query_source,
          "server.chat.stream_started",
          {
            requestId,
            sessionId,
          },
        );

        const onPartial = (text: string) => {
          partialText += text;
        };

        const isAgentModel = resolvedModel?.endsWith(AGENT_MODEL_SUFFIX) ??
          false;
        const configUsesAgentModel = cfgSnapshot.model.endsWith(
          AGENT_MODEL_SUFFIX,
        );
        const requestHasExplicitModel = typeof body.model === "string" &&
          body.model.length > 0;
        const effectiveMode = requestedMode === CLAUDE_CODE_AGENT_MODE
          ? CLAUDE_CODE_AGENT_MODE
          : (requestedMode === "agent" &&
              (
                isAgentModel ||
                (!requestHasExplicitModel &&
                  configUsesAgentModel)
              ))
          ? CLAUDE_CODE_AGENT_MODE
          : requestedMode;
        const runnerHandlesMemoryCapture = !isEvalMode &&
          effectiveMode === "agent" &&
          supportsAgentExecution(resolvedModel, resolvedModelInfo);

        if (
          !isEvalMode &&
          body.disable_persistent_memory !== true &&
          !runnerHandlesMemoryCapture
        ) {
          try {
            await persistExplicitMemoryRequest(currentUserMessage.content);
          } catch (error) {
            log.warn("Failed to persist explicit user memory request", error);
          }
        }

        if (isEvalMode) {
          const replState = await ensureRuntimeHostReplState();
          const evalAttachments = await buildEvalAttachments(
            getRequestAttachmentIds(body.messages),
          );
          const evalResult = await evaluate(
            currentUserMessage.content,
            replState,
            evalAttachments,
            controller.signal,
          );

          if (!evalResult.success) {
            throw evalResult.error ?? new Error("Execution failed");
          }

          for (const logLine of evalResult.logs ?? []) {
            const detail = logLine.trim();
            if (detail.length === 0) {
              continue;
            }
            emit({
              event: "trace",
              kind: "eval_log",
              detail,
            });
          }

          const hasValue = Object.prototype.hasOwnProperty.call(
            evalResult,
            "value",
          );
          const output = hasValue ? formatPlainValue(evalResult.value) : "";
          partialText = output;

          updateMessage(assistantMessageId, { content: output });
          const updatedAssistant = getMessage(assistantMessageId);
          pushSSEEvent(sessionId, "message_updated", {
            message: updatedAssistant
              ? await toRuntimeSessionMessage(updatedAssistant)
              : {
                id: assistantMessageId,
                content: output,
              },
          });
          pushConversationUpdatedEvent(sessionId);

          if (output.length > 0) {
            emit({ event: "token", text: output });
          }
        } else if (effectiveMode === CLAUDE_CODE_AGENT_MODE) {
          await handleClaudeCodeAgentMode(
            body,
            sessionId,
            assistantMessageId,
            controller.signal,
            emit,
            onPartial,
          );
        } else if (effectiveMode === "agent") {
          if (supportsAgentExecution(resolvedModel, resolvedModelInfo)) {
            try {
              resultStats = await handleAgentMode(
                body,
                sessionId,
                resolvedModel!,
                assistantMessageId,
                controller.signal,
                emit,
                onPartial,
                requestId,
                preTurnSessionVersion,
                resolvedModelInfo,
              );
            } catch (agentError) {
              // Auto-downgrade: if agent mode fails on first call (model
              // can't actually use tools), fall back to chat mode gracefully
              // instead of crashing. Covers unknown models with no capability data.
              const { classifyError } = await import(
                "../../../agent/error-taxonomy.ts"
              );
              const classified = await classifyError(agentError);
              if (classified.class === "permanent") {
                emit({
                  event: "trace",
                  kind: "agent_downgrade",
                  detail: `Agent mode failed (${
                    classified.message.slice(0, 80)
                  }), falling back to chat mode`,
                });
                await handleChatMode(
                  body,
                  resolvedModel,
                  sessionId,
                  assistantMessageId,
                  controller.signal,
                  emit,
                  onPartial,
                  requestId,
                  resolvedModelInfo,
                );
              } else {
                throw agentError;
              }
            }
          } else {
            await handleChatMode(
              body,
              resolvedModel,
              sessionId,
              assistantMessageId,
              controller.signal,
              emit,
              onPartial,
              requestId,
              resolvedModelInfo,
            );
          }
        } else {
          await handleChatMode(
            body,
            resolvedModel,
            sessionId,
            assistantMessageId,
            controller.signal,
            emit,
            onPartial,
            requestId,
            resolvedModelInfo,
          );
        }

        if (controller.signal.aborted) {
          emitCancellationOnce();
        } else {
          if (
            !isEvalMode &&
            body.disable_persistent_memory !== true &&
            !runnerHandlesMemoryCapture
          ) {
            try {
              await persistConversationFacts({
                userMessage: currentUserMessage.content,
                assistantMessage: partialText,
              });
            } catch (error) {
              log.warn("Failed to persist conversation memory", error);
            }
          }
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
              pushConversationUpdatedEvent(sessionId, { title: autoTitle });
            }
          }

          const updatedSession = getSession(sessionId);
          const completeEvent: Record<string, unknown> = {
            event: "complete",
            request_id: requestId,
            session_version: updatedSession?.session_version ?? 0,
          };
          if (resultStats) {
            completeEvent.stats = resultStats;
          }
          emit(completeEvent);
          traceReplMainThreadForSource(
            body.query_source,
            "server.chat.complete",
            {
              requestId,
              sessionId,
              partialTextChars: partialText.length,
              sessionVersion: updatedSession?.session_version ?? 0,
            },
          );
        }
      } catch (error) {
        if (controller.signal.aborted) {
          emitCancellationOnce();
        } else {
          await emitErrorState(error);
        }
      }

      streamClosed = true;
      clearInterval(heartbeatInterval);
      traceReplMainThreadForSource(
        body.query_source,
        "server.chat.stream_finally",
        {
          requestId,
          sessionId,
          partialTextChars: partialText.length,
          aborted: controller.signal.aborted,
        },
      );
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
