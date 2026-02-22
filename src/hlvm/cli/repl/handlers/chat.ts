/**
 * Chat Handler
 *
 * POST /api/chat — Unified streaming chat endpoint (chat + agent modes).
 * POST /api/chat/cancel — Cancel an in-flight request.
 *
 * Returns NDJSON stream with events: start, token, tool, complete, error, cancelled.
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
import { ai } from "../../../api/ai.ts";
import {
  ensureAgentReady,
  getOrCreateCachedSession,
  runAgentQuery,
} from "../../../agent/agent-runner.ts";
import { autoConfigureInitialClaudeCodeModel } from "../../../../common/ai-default-model.ts";
import { DEFAULT_TOOL_DENYLIST } from "../../../agent/constants.ts";
import type { InteractionResponse } from "../../../agent/orchestrator.ts";
import {
  isAgentOrchestratorFailureResponse,
  shouldSuppressFinalResponse,
} from "../../../agent/model-compat.ts";
import { getErrorMessage } from "../../../../common/utils.ts";
import { AI_NO_OUTPUT_FALLBACK_TEXT } from "../../../../common/ai-messages.ts";
import { RuntimeError, ValidationError } from "../../../../common/error.ts";
import { classifyError } from "../../../agent/error-taxonomy.ts";
import { log } from "../../../api/log.ts";
import {
  jsonError,
  ndjsonLine,
  parseJsonBody,
  textEncoder,
} from "../http-utils.ts";
import { type Message, parseModelString } from "../../../providers/index.ts";
import { loadRecentMessages } from "../../../store/message-utils.ts";
import type { Message as AgentMessage } from "../../../agent/context.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import type { ModelInfo } from "../../../providers/types.ts";
import { config } from "../../../api/config.ts";
import { isPaidProvider, isProviderApproved } from "../../commands/ask.ts";
import { AGENT_MODEL_SUFFIX } from "../../../providers/claude-code/provider.ts";
import {
  buildClaudeCodeCommand,
  captureSessionIdFromInitEvent,
  isSessionMemoryEnabled,
  parseSessionMemoryMetadata,
} from "./session-memory.ts";

const CHAT_CONTEXT_HISTORY_LIMIT = 80;
const TITLE_SEARCH_HISTORY_LIMIT = 40;
const AGENT_CONTEXT_HISTORY_LIMIT = 20;
const INTERACTION_TIMEOUT_MS = 300_000;

function pushSessionUpdatedEvent(sessionId: string): void {
  pushSSEEvent(SESSIONS_CHANNEL, "session_updated", { session_id: sessionId });
}

function getLastUserMessage(
  messages: ChatRequest["messages"],
): ChatRequest["messages"][number] | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return undefined;
}

// MARK: - Pending Interactions (GUI permission/question flow)

const MAX_PENDING_INTERACTIONS = 50;

const pendingInteractions = new Map<string, {
  resolve: (response: InteractionResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

/** POST /api/chat/interaction — Resolve a pending interaction request from the GUI */
export async function handleChatInteraction(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<{
    request_id?: string;
    approved?: boolean;
    remember_choice?: boolean;
    user_input?: string;
  }>(req);
  if (!parsed.ok) return parsed.response;

  const { request_id, approved, remember_choice, user_input } = parsed.value;
  if (!request_id) return jsonError("Missing request_id", 400);

  const pending = pendingInteractions.get(request_id);
  if (!pending) return jsonError("No pending interaction with that ID", 404);

  clearTimeout(pending.timer);
  pendingInteractions.delete(request_id);
  pending.resolve({
    approved: approved === true,
    rememberChoice: remember_choice,
    userInput: user_input,
  });

  return Response.json({ ok: true });
}

function awaitInteractionResponse(
  event: {
    requestId: string;
    mode: "permission" | "question";
    toolName?: string;
    toolArgs?: string;
    question?: string;
  },
  signal: AbortSignal,
  emit: (obj: unknown) => void,
): Promise<InteractionResponse> {
  emit({
    event: "interaction_request",
    request_id: event.requestId,
    mode: event.mode,
    tool_name: event.toolName,
    tool_args: event.toolArgs,
    question: event.question,
  });

  return new Promise<InteractionResponse>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finalize = (response: InteractionResponse) => {
      if (done) return;
      done = true;
      pendingInteractions.delete(event.requestId);
      if (timer) {
        clearTimeout(timer);
      }
      signal.removeEventListener("abort", onAbort);
      resolve(response);
    };

    const onAbort = () => {
      finalize({ approved: false });
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    if (pendingInteractions.size >= MAX_PENDING_INTERACTIONS) {
      finalize({ approved: false });
      return;
    }

    timer = setTimeout(() => {
      finalize({ approved: false });
    }, INTERACTION_TIMEOUT_MS);

    pendingInteractions.set(event.requestId, {
      resolve: (response) => finalize(response),
      timer,
    });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// MARK: - Image Helpers

async function readImageAsBase64(filePath: string): Promise<string | null> {
  try {
    const data = await getPlatform().fs.readFile(filePath);
    const chunks: string[] = [];
    for (let i = 0; i < data.length; i += 8192) {
      chunks.push(
        String.fromCharCode(
          ...data.subarray(i, Math.min(i + 8192, data.length)),
        ),
      );
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

/** Cached catalog result with TTL */
let _catalogCache: {
  data: Awaited<ReturnType<typeof ai.models.catalog>>;
  expiry: number;
} | null = null;
const CATALOG_CACHE_TTL_MS = 60_000;

async function modelSupportsTools(
  modelName: string,
  modelInfo: ModelInfo | null,
): Promise<boolean> {
  if (modelInfo?.capabilities) {
    return modelInfo.capabilities.includes("tools");
  }
  try {
    const now = Date.now();
    if (!_catalogCache || now > _catalogCache.expiry) {
      _catalogCache = {
        data: await ai.models.catalog(),
        expiry: now + CATALOG_CACHE_TTL_MS,
      };
    }
    const catalog = _catalogCache.data;
    const bare = modelName.includes("/")
      ? modelName.slice(modelName.indexOf("/") + 1)
      : modelName;
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
  // Fail closed: if we cannot verify tool capability, agent mode should not
  // proceed blindly.
  return false;
}

async function streamDirectChatFallback(
  sessionId: string,
  assistantMessageId: number,
  resolvedModel: string,
  body: ChatRequest,
  signal: AbortSignal,
  emit: (obj: unknown) => void,
  onPartial: (text: string) => void,
): Promise<string> {
  const cfgSnapshot = config.snapshot;
  const providerMessages = await buildProviderMessages(
    sessionId,
    assistantMessageId,
    CHAT_CONTEXT_HISTORY_LIMIT,
  );
  const tokenIterator = ai.chat(providerMessages, {
    model: resolvedModel,
    temperature: body.temperature ?? cfgSnapshot.temperature,
    maxTokens: body.max_tokens ?? cfgSnapshot.maxTokens,
    signal,
  })[Symbol.asyncIterator]();

  let fullText = "";
  const waitForAbort: Promise<"aborted"> = signal.aborted
    ? Promise.resolve("aborted")
    : new Promise((resolve) => {
      signal.addEventListener("abort", () => resolve("aborted"), {
        once: true,
      });
    });

  try {
    while (true) {
      if (signal.aborted) break;
      const nextPromise = tokenIterator.next();
      const nextOrAbort = await Promise.race([
        nextPromise.then((result) => ({ type: "next" as const, result })),
        waitForAbort.then(() => ({ type: "abort" as const })),
      ]);

      if (nextOrAbort.type === "abort") {
        nextPromise.catch(() => {});
        break;
      }
      if (nextOrAbort.result.done) break;

      const token = nextOrAbort.result.value;
      fullText += token;
      onPartial(token);
      emit({ event: "token", text: token });
    }
  } finally {
    try {
      await tokenIterator.return?.();
    } catch {
      // iterator already closed
    }
  }

  return fullText;
}

async function buildProviderMessages(
  sessionId: string,
  assistantMessageId: number,
  limit: number,
): Promise<Message[]> {
  const storedMessages = loadRecentMessages(sessionId, limit);
  const providerMessages: Message[] = [];
  for (const m of storedMessages) {
    if (
      m.role === "tool" || m.cancelled || m.content.length === 0 ||
      m.id === assistantMessageId
    ) {
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
  return providerMessages;
}

// MARK: - Constants

/** Mode string for Claude Code full agent passthrough */
const CLAUDE_CODE_AGENT_MODE = "claude-code-agent" as const;

// MARK: - Types

type ChatMode = "chat" | "agent" | typeof CLAUDE_CODE_AGENT_MODE;

interface ChatRequest {
  mode: ChatMode;
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
let agentReadyPromise: Promise<void> | null = null;

export function isAgentReady(): boolean {
  return agentReadyPromise !== null;
}

export function markAgentReady(): void {
  if (!agentReadyPromise) {
    agentReadyPromise = Promise.resolve();
  }
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

/**
 * @openapi
 * /api/sessions/{id}/cancel:
 *   post:
 *     tags: [Chat]
 *     summary: Cancel all in-flight requests for a session
 *     operationId: cancelSession
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID.
 *     responses:
 *       '200':
 *         description: Cancellation result.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cancelled:
 *                   type: boolean
 *                 session_id:
 *                   type: string
 *                 cancelled_count:
 *                   type: integer
 */
export function handleSessionCancel(sessionId: string): Response {
  const count = cancelSessionRequests(sessionId);
  return Response.json({
    cancelled: count > 0,
    session_id: sessionId,
    cancelled_count: count,
  });
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
  pushSessionUpdatedEvent(sessionId);
  emit({
    event: "cancelled",
    request_id: requestId,
    partial_text: partialText,
  });
}

// MARK: - Public Methods

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

  let resolvedModelInfo: ModelInfo | null = null;
  let modelDiscoveryFailed = false;
  if (resolvedModel) {
    const [parsedProvider, parsedModelName] = parseModelString(resolvedModel);
    try {
      resolvedModelInfo = await ai.models.get(
        parsedModelName,
        parsedProvider ?? undefined,
      );
    } catch {
      // Model discovery failed (timeout, network) — continue without model info
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
    if (
      body.mode === "agent" &&
      !(await modelSupportsTools(resolvedModel, resolvedModelInfo))
    ) {
      return jsonError(
        body.model
          ? "Selected model does not support tool calling"
          : "Default model does not support tool calling",
        400,
      );
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

        // Resolve effective mode: model name ending in ":agent" suffix OR config agentMode override
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
          // Ensure the assistant message is updated even on error so the GUI
          // replaces the "Thinking..." placeholder with visible content.
          const displayContent = partialText.length > 0
            ? `${partialText}\n\n[Error: ${errorMsg}]`
            : `Error: ${errorMsg}`;
          updateMessage(assistantMessageId, { content: displayContent });
          pushSSEEvent(sessionId, "message_updated", {
            id: assistantMessageId,
            content: displayContent,
          });
          pushSessionUpdatedEvent(sessionId);
          // Also emit a token so streaming normalizers clear the placeholder
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

// MARK: - Chat Mode (Private Helpers)

async function handleChatMode(
  body: ChatRequest,
  resolvedModel: string | undefined,
  sessionId: string,
  assistantMessageId: number,
  signal: AbortSignal,
  emit: (obj: unknown) => void,
  onPartial: (text: string) => void,
): Promise<void> {
  const providerMessages = await buildProviderMessages(
    sessionId,
    assistantMessageId,
    CHAT_CONTEXT_HISTORY_LIMIT,
  );

  let fullText = "";

  const cfgSnapshot = config.snapshot;
  const tokenIterator = ai.chat(providerMessages, {
    model: resolvedModel,
    temperature: body.temperature ?? cfgSnapshot.temperature,
    maxTokens: body.max_tokens ?? cfgSnapshot.maxTokens,
    signal,
  })[Symbol.asyncIterator]();

  const waitForAbort: Promise<"aborted"> = signal.aborted
    ? Promise.resolve("aborted")
    : new Promise((resolve) => {
      signal.addEventListener("abort", () => resolve("aborted"), {
        once: true,
      });
    });

  try {
    while (true) {
      if (signal.aborted) break;

      const nextPromise = tokenIterator.next();
      const nextOrAbort = await Promise.race([
        nextPromise.then((result) => ({ type: "next" as const, result })),
        waitForAbort.then(() => ({ type: "abort" as const })),
      ]);

      if (nextOrAbort.type === "abort") {
        nextPromise.catch(() => {});
        break;
      }

      if (nextOrAbort.result.done) break;

      const token = nextOrAbort.result.value;
      fullText += token;
      onPartial(token);
      emit({ event: "token", text: token });
    }
  } finally {
    try {
      await tokenIterator.return?.();
    } catch { /* already closed */ }
  }

  if (!signal.aborted) {
    updateMessage(assistantMessageId, { content: fullText });
    pushSSEEvent(sessionId, "message_updated", {
      id: assistantMessageId,
      content: fullText,
    });
    pushSessionUpdatedEvent(sessionId);
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
  modelInfo?: ModelInfo | null,
): Promise<void> {
  if (!agentReadyPromise) {
    agentReadyPromise = ensureAgentReady(resolvedModel, (msg) => log.info(msg))
      .catch((err) => {
        agentReadyPromise = null;
        throw err;
      });
  }
  await agentReadyPromise;

  const workspace = getPlatform().process.cwd();
  const cachedSession = await getOrCreateCachedSession(
    workspace,
    resolvedModel,
    { toolDenylist: [...DEFAULT_TOOL_DENYLIST], modelInfo },
  );

  const stored = loadRecentMessages(
    body.session_id,
    AGENT_CONTEXT_HISTORY_LIMIT,
  );
  const history: AgentMessage[] = stored
    .filter((m) =>
      !m.cancelled && m.content.length > 0 && m.id !== assistantMessageId &&
      // Skip tool messages and tool-bearing assistant messages from prior turns:
      // SQLite doesn't persist tool_call_ids reliably, producing orphaned
      // tool_result blocks that Anthropic (and other strict providers) reject.
      m.role !== "tool" && !m.tool_calls
    )
    .map((m) => ({
      role: m.role as AgentMessage["role"],
      content: m.content,
      timestamp: new Date(m.created_at).getTime(),
    }));

  const lastUserMessage = getLastUserMessage(body.messages);
  const query = lastUserMessage?.content ?? "";
  let streamedFinalText = false;
  let successfulToolCalls = 0;
  let failedToolCalls = 0;

  const result = await runAgentQuery({
    query,
    model: resolvedModel,
    autoApprove: false,
    noInput: false,
    signal,
    toolDenylist: [...DEFAULT_TOOL_DENYLIST],
    messageHistory: history,
    modelInfo,
    cachedSession,
    callbacks: {
      onInteraction: async (event) => {
        return await awaitInteractionResponse(event, signal, emit);
      },
      onAgentEvent: (event) => {
        switch (event.type) {
          case "thinking":
            emit({ event: "thinking", iteration: event.iteration });
            break;
          case "tool_start":
            emit({
              event: "tool_start",
              name: event.name,
              args_summary: event.argsSummary,
              tool_index: event.toolIndex,
              tool_total: event.toolTotal,
            });
            break;
          case "tool_end": {
            if (event.success) {
              successfulToolCalls += 1;
            } else {
              failedToolCalls += 1;
            }
            const toolMsg = insertMessage({
              session_id: body.session_id,
              role: "tool",
              content: event.content ?? "",
              tool_name: event.name,
              sender_type: "agent",
              request_id: requestId,
            });
            pushSSEEvent(body.session_id, "message_added", {
              message: toolMsg,
            });
            pushSessionUpdatedEvent(body.session_id);
            emit({
              event: "tool_end",
              name: event.name,
              success: event.success,
              content: event.content,
              duration_ms: event.durationMs,
              args_summary: event.argsSummary,
            });
            break;
          }
          case "turn_stats":
            emit({
              event: "turn_stats",
              iteration: event.iteration,
              tool_count: event.toolCount,
              duration_ms: event.durationMs,
            });
            break;
          case "interaction_request":
            // Already handled by onInteraction callback
            break;
        }
      },
    },
  });

  if (!signal.aborted) {
    let finalText = result.text;
    const shouldFallbackToDirectChat =
      shouldSuppressFinalResponse(finalText) ||
      isAgentOrchestratorFailureResponse(finalText) ||
      (failedToolCalls > 0 && successfulToolCalls === 0 && !finalText.trim());
    if (shouldFallbackToDirectChat) {
      const fallbackText = await streamDirectChatFallback(
        body.session_id,
        assistantMessageId,
        resolvedModel,
        body,
        signal,
        emit,
        onPartial,
      );
      if (fallbackText.trim().length > 0) {
        finalText = fallbackText;
        streamedFinalText = true;
      }
    }

    if (finalText.trim().length === 0) {
      finalText = AI_NO_OUTPUT_FALLBACK_TEXT;
      streamedFinalText = false;
    }

    if (!streamedFinalText) {
      onPartial(finalText);
      emit({ event: "token", text: finalText });
    }

    updateMessage(assistantMessageId, { content: finalText });
    pushSSEEvent(body.session_id, "message_updated", {
      id: assistantMessageId,
      content: finalText,
    });
    pushSessionUpdatedEvent(body.session_id);
  }
}

/**
 * Claude Code Agent Mode — delegates the entire agentic loop to Claude Code CLI.
 *
 * Spawns `claude -p "<query>" --output-format stream-json` as a subprocess and streams
 * stdout back as SSE events. Claude Code handles tool calling, file ops, etc. internally.
 *
 * Session Memory: When enabled (default), captures the Claude Code session_id from the
 * init event and stores it in HLVM session metadata. On subsequent messages in the same
 * session, passes `--resume <session_id>` so Claude Code remembers prior context.
 */
async function handleClaudeCodeAgentMode(
  body: ChatRequest,
  assistantMessageId: number,
  signal: AbortSignal,
  emit: (obj: unknown) => void,
  onPartial: (text: string) => void,
): Promise<void> {
  const lastUserMessage = getLastUserMessage(body.messages);
  const query = lastUserMessage?.content ?? "";

  if (!query.trim()) {
    throw new ValidationError(
      "Empty query for Claude Code agent",
      "claude_code_agent_mode",
    );
  }

  const cfgSnapshot = config.snapshot;
  const sessionMemoryEnabled = isSessionMemoryEnabled(
    cfgSnapshot.sessionMemory,
  );

  // Read stored Claude Code session ID from HLVM session metadata
  let claudeCodeSessionId: string | null = null;
  let existingMeta: Record<string, unknown> = {};
  if (sessionMemoryEnabled) {
    const session = getSession(body.session_id);
    const parsedMeta = parseSessionMemoryMetadata(session?.metadata);
    existingMeta = parsedMeta.existingMeta;
    claudeCodeSessionId = parsedMeta.claudeCodeSessionId;
  }

  const result = await spawnClaudeCodeProcess(
    query,
    claudeCodeSessionId,
    body.session_id,
    assistantMessageId,
    sessionMemoryEnabled,
    existingMeta,
    signal,
    emit,
    onPartial,
  );

  if (!result.success && !signal.aborted) {
    if (claudeCodeSessionId) {
      // --resume failed, clear stored session and retry fresh
      log.info(
        `Claude Code --resume failed (session ${claudeCodeSessionId}), retrying fresh`,
      );
      existingMeta.claudeCodeSessionId = undefined;
      updateSession(body.session_id, {
        metadata: JSON.stringify(existingMeta),
      });
      const retryResult = await spawnClaudeCodeProcess(
        query,
        null,
        body.session_id,
        assistantMessageId,
        sessionMemoryEnabled,
        existingMeta,
        signal,
        emit,
        onPartial,
      );
      if (!retryResult.success && !signal.aborted) {
        throw new RuntimeError(
          retryResult.error ?? "Claude Code failed after retry",
        );
      }
    } else {
      throw new RuntimeError(result.error ?? "Claude Code failed");
    }
  }
}

/** Process a single NDJSON line from Claude Code stream-json output. */
function processClaudeCodeJsonLine(
  trimmed: string,
  state: { fullText: string },
  sessionMemoryEnabled: boolean,
  claudeCodeSessionId: string | null,
  existingMeta: Record<string, unknown>,
  hlvmSessionId: string,
  emit: (obj: unknown) => void,
  onPartial: (text: string) => void,
): void {
  try {
    const event = JSON.parse(trimmed);

    if (
      captureSessionIdFromInitEvent(
        event,
        sessionMemoryEnabled,
        claudeCodeSessionId,
        existingMeta,
      )
    ) {
      updateSession(hlvmSessionId, { metadata: JSON.stringify(existingMeta) });
    }

    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) {
          state.fullText += block.text;
          onPartial(block.text);
          emit({ event: "token", text: block.text });
        }
      }
    } else if (event.type === "content_block_delta" && event.delta?.text) {
      state.fullText += event.delta.text;
      onPartial(event.delta.text);
      emit({ event: "token", text: event.delta.text });
    } else if (event.type === "result" && event.result) {
      if (typeof event.result === "string" && event.result.length > 0) {
        state.fullText = event.result;
      }
    }
  } catch {
    if (trimmed.length > 0) {
      state.fullText += trimmed + "\n";
      onPartial(trimmed + "\n");
      emit({ event: "token", text: trimmed + "\n" });
    }
  }
}

/**
 * Build a complete subprocess environment for the claude CLI.
 * GUI-spawned processes often receive a minimal environment (HOME, PATH only),
 * missing critical vars that claude needs for Keychain access and normal operation.
 * This function inherits existing vars and fills in any missing essentials.
 */
function buildClaudeSubprocessEnv(): Record<string, string> {
  const platform = getPlatform();
  const env = platform.env.toObject();

  const home = env.HOME ?? "";

  // Derive USER/LOGNAME from HOME if missing (e.g. /Users/alice → alice)
  if (!env.USER && home) {
    const parts = home.split("/").filter(Boolean);
    env.USER = parts[parts.length - 1] ?? "";
  }
  if (!env.LOGNAME) env.LOGNAME = env.USER ?? "";

  // Ensure TMPDIR, SHELL, LANG have sensible defaults
  if (!env.TMPDIR) env.TMPDIR = "/tmp";
  if (!env.SHELL) env.SHELL = "/bin/zsh";
  if (!env.LANG) env.LANG = "en_US.UTF-8";
  if (!env.TERM) env.TERM = "xterm-256color";

  // Ensure ~/.local/bin is in PATH (where claude is typically installed)
  if (home && env.PATH && !env.PATH.includes(`${home}/.local/bin`)) {
    env.PATH = `${home}/.local/bin:${env.PATH}`;
  }

  return env;
}

/** Spawn Claude Code CLI subprocess and stream results. Returns success status. */
async function spawnClaudeCodeProcess(
  query: string,
  claudeCodeSessionId: string | null,
  hlvmSessionId: string,
  assistantMessageId: number,
  sessionMemoryEnabled: boolean,
  existingMeta: Record<string, unknown>,
  signal: AbortSignal,
  emit: (obj: unknown) => void,
  onPartial: (text: string) => void,
): Promise<{ success: boolean; error?: string }> {
  const platform = getPlatform();

  const cmd = buildClaudeCodeCommand(query, claudeCodeSessionId);

  const proc = platform.command.run({
    cmd,
    env: buildClaudeSubprocessEnv(),
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
  });

  // Kill subprocess on abort
  const onAbort = () => {
    proc.kill?.("SIGTERM");
  };
  signal.addEventListener("abort", onAbort, { once: true });

  let fullText = "";

  try {
    const stdout = proc.stdout as ReadableStream<Uint8Array> | undefined;
    if (!stdout) {
      return { success: false, error: "Failed to capture Claude Code output" };
    }

    // Bug 4 fix: Drain stderr concurrently to prevent pipe deadlock
    const stderrPromise = (async () => {
      const stderr = proc.stderr as ReadableStream<Uint8Array> | undefined;
      if (!stderr) return "";
      try {
        const errReader = stderr.getReader();
        const chunks: string[] = [];
        while (true) {
          const { done: errDone, value: errValue } = await errReader.read();
          if (errDone) break;
          chunks.push(new TextDecoder().decode(errValue));
        }
        return chunks.join("").trim();
      } catch {
        return "";
      }
    })();

    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const textState = { fullText };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete JSON lines (stream-json outputs one JSON object per line)
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // Keep incomplete last line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        processClaudeCodeJsonLine(
          trimmed,
          textState,
          sessionMemoryEnabled,
          claudeCodeSessionId,
          existingMeta,
          hlvmSessionId,
          emit,
          onPartial,
        );
      }
    }

    // Bug 3 fix: Process residual buffer after EOF (final line may lack trailing newline)
    const residual = buffer.trim();
    if (residual) {
      processClaudeCodeJsonLine(
        residual,
        textState,
        sessionMemoryEnabled,
        claudeCodeSessionId,
        existingMeta,
        hlvmSessionId,
        emit,
        onPartial,
      );
    }

    fullText = textState.fullText;

    // Wait for process to finish
    const result = await proc.status;
    if (!result.success && !signal.aborted) {
      const errText = await stderrPromise;
      const errMsg = errText || `Claude Code exited with code ${result.code}`;
      return { success: false, error: errMsg };
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }

  if (!signal.aborted) {
    updateMessage(assistantMessageId, { content: fullText });
    pushSSEEvent(hlvmSessionId, "message_updated", {
      id: assistantMessageId,
      content: fullText,
    });
    pushSessionUpdatedEvent(hlvmSessionId);
  }

  return { success: true };
}
