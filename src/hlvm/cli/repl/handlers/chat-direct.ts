/**
 * Direct chat mode: streaming LLM responses, model validation.
 * Extracted from chat.ts for modularity.
 */

import { ai } from "../../../api/ai.ts";
import { RuntimeError } from "../../../../common/error.ts";
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
import {
  isLocalFallbackReady,
  LOCAL_FALLBACK_MODEL_ID,
  withFallbackChain,
} from "../../../runtime/local-fallback.ts";
import { getLocalModelDisplayName } from "../../../runtime/local-llm.ts";

const LOCAL_FALLBACK_READY_MESSAGE =
  `Local ${getLocalModelDisplayName()} is still preparing. Try again in a moment.`;
const LOCAL_FALLBACK_RETRY_MESSAGE =
  `Selected model failed. Retrying once with local ${getLocalModelDisplayName()}.`;
const LOCAL_FALLBACK_PREPARING_MESSAGE =
  `Selected model failed, and local ${getLocalModelDisplayName()} is still preparing. Try again in a moment.`;

/** Resolve "auto" to a real model ID with scored fallbacks, or pass through unchanged. */
async function resolveAutoForChat(
  model: string | undefined,
  body: ChatRequest,
  emit: (obj: unknown) => void,
): Promise<{ effectiveModel: string | undefined; scoredFallbacks: string[] }> {
  if (model !== "auto") return { effectiveModel: model, scoredFallbacks: [] };

  const { resolveAutoModel } = await import("../../../agent/auto-select.ts");
  const query = body.messages?.find((m) => m.role === "user")?.content ?? "";
  const autoDecision = await resolveAutoModel(
    typeof query === "string" ? query : "",
  );
  emit({ event: "trace", kind: "auto_select", detail: autoDecision.reason });
  return { effectiveModel: autoDecision.model, scoredFallbacks: autoDecision.fallbacks };
}

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
  scoredFallbacks: string[] = [],
): Promise<string> {
  if (resolvedModel === LOCAL_FALLBACK_MODEL_ID && !(await isLocalFallbackReady())) {
    throw new RuntimeError(LOCAL_FALLBACK_READY_MESSAGE);
  }

  let emittedAnyToken = false;
  const forwardChunk = (token: string) => {
    emittedAnyToken = true;
    onChunk(token);
    emit({ event: "token", text: token });
  };

  const tryStream = (model: string | undefined) =>
    drainTokenStream(
      createChatTokenIterator(providerMessages, model, body, weakContextRawLimit, signal),
      signal,
      forwardChunk,
    );

  return withFallbackChain<string>({
    tryPrimary: () => tryStream(resolvedModel),
    fallbacks: emittedAnyToken || resolvedModel?.startsWith("ollama/")
      ? []
      : scoredFallbacks,
    tryFallback: (model) => {
      emit({ event: "warning", message: `Switching to ${model}...` });
      return tryStream(model);
    },
    lastResort: emittedAnyToken || resolvedModel?.startsWith("ollama/")
      ? undefined
      : { model: LOCAL_FALLBACK_MODEL_ID, isAvailable: isLocalFallbackReady },
    tryLastResort: (model) => {
      emit({ event: "warning", message: LOCAL_FALLBACK_RETRY_MESSAGE });
      return tryStream(model);
    },
    onLastResortUnavailable: (err) => {
      throw new RuntimeError(LOCAL_FALLBACK_PREPARING_MESSAGE, {
        originalError: err instanceof Error ? err : undefined,
      });
    },
  });
}

function getChatSystemPrompt(): string {
  return compilePrompt({
    mode: "chat",
    tier: "standard",
    tools: {},
    instructions: EMPTY_INSTRUCTIONS,
  }).text;
}

function buildCapturedContextSystemMessage(
  capturedContexts: ChatRequest["captured_contexts"],
) {
  if (!capturedContexts?.length) return null;

  const toPromptEntry = (context: NonNullable<ChatRequest["captured_contexts"]>[number]) => {
    const entry: Record<string, string> = {
      type: context.source,
      name: context.name,
    };
    for (const [key, value] of Object.entries(context.metadata ?? {})) {
      entry[key] = value;
    }
    if (typeof context.detail === "string" && context.detail.length > 0) {
      entry.detail = context.detail;
    }
    return entry;
  };

  const referenceContexts = capturedContexts.filter((context) =>
    context.source === "reference"
  );
  const localContexts = capturedContexts.filter((context) =>
    context.source !== "reference"
  );

  const sections: string[] = [];
  if (referenceContexts.length > 0) {
    sections.push(
      [
        "Referenced Items (the user has pinned these items — focus your response on them):",
        JSON.stringify(referenceContexts.map(toPromptEntry), null, 2),
      ].join("\n"),
    );
  }
  if (localContexts.length > 0) {
    sections.push(
      [
        "Captured Contexts:",
        JSON.stringify(localContexts.map(toPromptEntry), null, 2),
      ].join("\n"),
    );
  }
  if (sections.length === 0) return null;

  return {
    role: "system" as const,
    content: [
      "Supplemental local GUI context. Use this only when it helps answer the user's request.",
      sections.join("\n\n"),
    ].join("\n\n"),
  };
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
  // Resolve "auto" to a concrete model before passing to ai.chat()
  const { effectiveModel, scoredFallbacks } = await resolveAutoForChat(
    resolvedModel,
    body,
    emit,
  );

  const requestOverridesStoredHistory = shouldHonorRequestMessages(body.messages);
  const weakLocalDirectChat = isWeakLocalDirectChatModel(
    effectiveModel,
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
    modelKey: effectiveModel,
    prependReplayMessages: weakContext?.prependReplayMessages,
    contextBudgetOverride: weakContext?.resolvedContextBudget,
  });
  providerMessages.unshift({
    role: "system",
    content: getChatSystemPrompt(),
  });
  const capturedContextMessage = buildCapturedContextSystemMessage(
    body.captured_contexts,
  );
  if (capturedContextMessage) {
    const lastUserIndex = providerMessages.findLastIndex((message) =>
      message.role === "user"
    );
    const insertionIndex = lastUserIndex >= 0 ? lastUserIndex : providerMessages.length;
    providerMessages.splice(insertionIndex, 0, capturedContextMessage);
  }
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
    effectiveModel,
    body,
    signal,
    emit,
    onPartial,
    weakContext ? resolvedContextBudget.rawLimit : undefined,
    scoredFallbacks,
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
  // Resolve "auto" to a concrete model before passing to ai.chat()
  const { effectiveModel, scoredFallbacks } = await resolveAutoForChat(
    resolvedModel,
    body,
    emit,
  );

  const storedMessages = shouldHonorRequestMessages(requestMessages)
    ? []
    : loadAllMessages(sessionId);
  const { messages: providerMessages } = await buildChatProviderMessages({
    requestMessages,
    storedMessages,
    assistantMessageId,
    disablePersistentMemory: body.disable_persistent_memory === true,
    modelInfo,
    modelKey: effectiveModel,
  });
  providerMessages.unshift({
    role: "system",
    content: getChatSystemPrompt(),
  });

  return await streamChatWithFallback(
    providerMessages,
    effectiveModel,
    body,
    signal,
    emit,
    onPartial,
    undefined,
    scoredFallbacks,
  );
}
