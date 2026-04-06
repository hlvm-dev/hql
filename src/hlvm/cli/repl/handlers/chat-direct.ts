/**
 * Direct chat mode: streaming LLM responses, model validation.
 * Extracted from chat.ts for modularity.
 */

import { ai } from "../../../api/ai.ts";
import { RuntimeError } from "../../../../common/error.ts";
import {
  isProviderErrorCode,
  parseErrorCodeFromMessage,
  ProviderErrorCode,
} from "../../../../common/error-codes.ts";
import {
  getMessage,
  getSession,
  updateMessage,
} from "../../../store/conversation-store.ts";
import { pushSSEEvent } from "../../../store/sse-store.ts";
import { config } from "../../../api/config.ts";
import { loadAllMessages } from "../../../store/message-utils.ts";
import type { ModelInfo } from "../../../providers/types.ts";
import { toRuntimeSessionMessage } from "../../../runtime/session-protocol.ts";
import { pushConversationUpdatedEvent, type ChatRequest } from "./chat-session.ts";
import {
  buildChatProviderMessages,
  shouldHonorRequestMessages,
} from "./chat-context.ts";
import { compilePrompt, EMPTY_INSTRUCTIONS } from "../../../prompt/mod.ts";
import {
  buildWeakDirectChatContext,
  isWeakLocalDirectChatModel,
  scheduleWeakDirectChatSummaryMaintenance,
} from "./direct-chat-history.ts";
import { traceReplMainThreadForSource } from "../../../repl-main-thread-trace.ts";
import { LOCAL_FALLBACK_MODEL } from "../../../runtime/bootstrap-manifest.ts";
import { isRuntimeReadyForAiRequests } from "../../commands/serve.ts";

const LOCAL_FALLBACK_MODEL_ID = `ollama/${LOCAL_FALLBACK_MODEL}`;
const LOCAL_FALLBACK_READY_MESSAGE =
  "Local Gemma 4 is still preparing. Try again in a moment.";
const LOCAL_FALLBACK_RETRY_MESSAGE =
  "Selected model failed. Retrying once with local Gemma 4.";
const LOCAL_FALLBACK_PREPARING_MESSAGE =
  "Selected model failed, and local Gemma 4 is still preparing. Try again in a moment.";
const RETRYABLE_LOCAL_FALLBACK_CODES = new Set<ProviderErrorCode>([
  ProviderErrorCode.AUTH_FAILED,
  ProviderErrorCode.RATE_LIMITED,
  ProviderErrorCode.SERVICE_UNAVAILABLE,
  ProviderErrorCode.NETWORK_ERROR,
  ProviderErrorCode.REQUEST_TIMEOUT,
  ProviderErrorCode.REQUEST_FAILED,
]);

/** Drain a token iterator with abort support, forwarding each chunk. */
async function drainTokenStream(
  tokenIterator: AsyncIterator<string>,
  signal: AbortSignal,
  onChunk: (token: string) => void,
): Promise<string> {
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
      onChunk(token);
    }
  } finally {
    try {
      await tokenIterator.return?.();
    } catch { /* already closed */ }
  }

  return fullText;
}

function isLocalFallbackModel(modelId: string | undefined): boolean {
  return modelId === LOCAL_FALLBACK_MODEL_ID;
}

function extractProviderErrorCode(error: unknown): ProviderErrorCode | null {
  const directCode = typeof (error as { code?: unknown })?.code === "number"
    ? (error as { code: number }).code
    : null;
  if (directCode !== null && isProviderErrorCode(directCode)) {
    return directCode;
  }
  if (error instanceof Error) {
    const parsed = parseErrorCodeFromMessage(error.message);
    if (parsed !== null && isProviderErrorCode(parsed)) {
      return parsed;
    }
  }
  return null;
}

function shouldRetryWithLocalFallback(
  error: unknown,
  selectedModel: string | undefined,
): boolean {
  if (!selectedModel || selectedModel.startsWith("ollama/")) {
    return false;
  }
  const code = extractProviderErrorCode(error);
  return code !== null && RETRYABLE_LOCAL_FALLBACK_CODES.has(code);
}

function createChatTokenIterator(
  providerMessages: Awaited<ReturnType<typeof buildChatProviderMessages>>["messages"],
  modelId: string | undefined,
  body: ChatRequest,
  weakContextRawLimit: number | undefined,
  signal: AbortSignal,
): AsyncIterator<string> {
  const cfgSnapshot = config.snapshot;
  return ai.chat(providerMessages, {
    model: modelId,
    temperature: body.temperature ?? cfgSnapshot.temperature,
    maxTokens: body.max_tokens ?? cfgSnapshot.maxTokens,
    signal,
    ...(typeof weakContextRawLimit === "number"
      ? { raw: { num_ctx: weakContextRawLimit } }
      : {}),
  })[Symbol.asyncIterator]();
}

async function streamChatWithFallback(
  providerMessages: Awaited<ReturnType<typeof buildChatProviderMessages>>["messages"],
  resolvedModel: string | undefined,
  body: ChatRequest,
  signal: AbortSignal,
  emit: (obj: unknown) => void,
  onChunk: (token: string) => void,
  weakContextRawLimit?: number,
): Promise<string> {
  if (isLocalFallbackModel(resolvedModel) && !isRuntimeReadyForAiRequests()) {
    throw new RuntimeError(LOCAL_FALLBACK_READY_MESSAGE);
  }

  let emittedAnyToken = false;
  const forwardChunk = (token: string) => {
    emittedAnyToken = true;
    onChunk(token);
    emit({ event: "token", text: token });
  };

  try {
    return await drainTokenStream(
      createChatTokenIterator(
        providerMessages,
        resolvedModel,
        body,
        weakContextRawLimit,
        signal,
      ),
      signal,
      forwardChunk,
    );
  } catch (error) {
    if (emittedAnyToken || !shouldRetryWithLocalFallback(error, resolvedModel)) {
      throw error;
    }
    if (!isRuntimeReadyForAiRequests()) {
      throw new RuntimeError(LOCAL_FALLBACK_PREPARING_MESSAGE, {
        originalError: error instanceof Error ? error : undefined,
      });
    }

    emit({ event: "warning", message: LOCAL_FALLBACK_RETRY_MESSAGE });

    return await drainTokenStream(
      createChatTokenIterator(
        providerMessages,
        LOCAL_FALLBACK_MODEL_ID,
        body,
        weakContextRawLimit,
        signal,
      ),
      signal,
      forwardChunk,
    );
  }
}

function getChatSystemPrompt(): string {
  return compilePrompt({
    mode: "chat",
    tier: "mid",
    tools: {},
    instructions: EMPTY_INSTRUCTIONS,
  }).text;
}

export async function handleChatMode(
  body: ChatRequest,
  resolvedModel: string | undefined,
  sessionId: string,
  assistantMessageId: number,
  signal: AbortSignal,
  emit: (obj: unknown) => void,
  onPartial: (text: string) => void,
  requestId?: string,
  modelInfo?: ModelInfo | null,
): Promise<void> {
  const requestOverridesStoredHistory = shouldHonorRequestMessages(body.messages);
  const weakLocalDirectChat = isWeakLocalDirectChatModel(
    resolvedModel,
    modelInfo,
  );
  const weakContext = weakLocalDirectChat && !requestOverridesStoredHistory
    ? buildWeakDirectChatContext(
      sessionId,
      getSession(sessionId)?.metadata,
      modelInfo,
    )
    : undefined;
  const storedMessages = requestOverridesStoredHistory
    ? []
    : weakContext?.storedMessages ?? loadAllMessages(sessionId);
  const { messages: providerMessages, resolvedContextBudget } =
    await buildChatProviderMessages({
    requestMessages: body.messages,
    storedMessages,
    assistantMessageId,
    disablePersistentMemory: body.disable_persistent_memory === true,
    modelInfo,
    modelKey: resolvedModel,
    prependReplayMessages: weakContext?.prependReplayMessages,
    contextBudgetOverride: weakContext?.resolvedContextBudget,
  });
  providerMessages.unshift({
    role: "system",
    content: getChatSystemPrompt(),
  });
  traceReplMainThreadForSource(body.query_source, "server.chat.context_ready", {
    requestId: requestId ?? null,
    sessionId,
    historyStrategy: weakContext?.historyStrategy ?? "persisted_replay",
    summaryChars: weakContext?.summaryChars ?? 0,
    summarizedThroughOrder: weakContext?.summarizedThroughOrder ?? 0,
    recentRawGroupCount: weakContext?.recentRawGroupCount ?? 0,
    weakContextBudget: weakContext?.weakContextBudget ?? null,
    providerMessageCount: providerMessages.length,
    contextBudget: resolvedContextBudget.budget,
    numCtx: weakContext ? resolvedContextBudget.rawLimit : null,
  });

  const fullText = await streamChatWithFallback(
    providerMessages,
    resolvedModel,
    body,
    signal,
    emit,
    onPartial,
    weakContext ? resolvedContextBudget.rawLimit : undefined,
  );

  if (!signal.aborted) {
    updateMessage(assistantMessageId, { content: fullText });
    const updatedAssistant = getMessage(assistantMessageId);
    pushSSEEvent(sessionId, "message_updated", {
      message: updatedAssistant
        ? await toRuntimeSessionMessage(updatedAssistant)
        : {
          id: assistantMessageId,
          content: fullText,
        },
    });
    pushConversationUpdatedEvent(sessionId);
    if (weakContext) {
      scheduleWeakDirectChatSummaryMaintenance(sessionId);
    }
  }
}

export async function streamDirectChatFallback(
  requestMessages: ChatRequest["messages"],
  sessionId: string,
  assistantMessageId: number,
  resolvedModel: string,
  body: ChatRequest,
  signal: AbortSignal,
  emit: (obj: unknown) => void,
  onPartial: (text: string) => void,
  modelInfo?: ModelInfo | null,
): Promise<string> {
  const storedMessages = shouldHonorRequestMessages(requestMessages)
    ? []
    : loadAllMessages(sessionId);
  const { messages: providerMessages } = await buildChatProviderMessages({
    requestMessages,
    storedMessages,
    assistantMessageId,
    disablePersistentMemory: body.disable_persistent_memory === true,
    modelInfo,
    modelKey: resolvedModel,
  });
  providerMessages.unshift({
    role: "system",
    content: getChatSystemPrompt(),
  });

  return await streamChatWithFallback(
    providerMessages,
    resolvedModel,
    body,
    signal,
    emit,
    onPartial,
  );
}
