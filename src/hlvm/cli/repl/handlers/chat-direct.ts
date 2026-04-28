/**
 * Direct chat mode: streaming LLM responses, model validation.
 */

import { ai } from "../../../api/ai.ts";
import { AUTO_MODEL_ID } from "../../../../common/config/types.ts";
import { RuntimeError } from "../../../../common/error.ts";
import { TextAccumulator } from "../../../../common/stream-utils.ts";
import {
  getMessage,
  getSession,
  updateMessage,
} from "../../../store/conversation-store.ts";
import { pushSSEEvent } from "../../../store/sse-store.ts";
import { pushGuiLiveTranscriptEvent } from "../../../store/gui-live-transcript.ts";
import { config } from "../../../api/config.ts";
import { loadAllMessages } from "../../../store/message-utils.ts";
import type { ModelInfo } from "../../../providers/types.ts";
import { toRuntimeSessionMessage } from "../../../runtime/session-protocol.ts";
import {
  type ChatRequest,
  pushConversationUpdatedEvent,
} from "./chat-session.ts";
import {
  buildChatProviderMessages,
  shouldHonorRequestMessages,
} from "./chat-context.ts";
import { compilePrompt } from "../../../prompt/mod.ts";
import {
  buildWeakDirectChatContext,
  isWeakLocalDirectChatModel,
  scheduleWeakDirectChatSummaryMaintenance,
} from "./direct-chat-history.ts";
import { traceReplMainThreadForSource } from "../../../repl-main-thread-trace.ts";
import {
  isLocalFallbackReady,
  resolveLocalFallbackModelId,
  withFallbackChain,
} from "../../../runtime/local-fallback.ts";
import { getLocalModelDisplayName } from "../../../runtime/local-llm.ts";
import { recordAutoModelFailure } from "../../../agent/auto-select.ts";

const LOCAL_FALLBACK_READY_MESSAGE =
  `Local ${getLocalModelDisplayName()} is still preparing. Try again in a moment.`;
const LOCAL_FALLBACK_RETRY_MESSAGE =
  `Selected model failed. Retrying once with local ${getLocalModelDisplayName()}.`;
function localFallbackPreparingMessage(model: string | undefined): string {
  return `Model ${
    model ?? "selected model"
  } failed, and local ${getLocalModelDisplayName()} is still preparing. Try again in a moment.`;
}

export interface ResolvedChatModel {
  effectiveModel: string | undefined;
  scoredFallbacks: string[];
  autoSelectionReason?: string;
}

export async function resolveChatModelForRequest(
  model: string | undefined,
  body: ChatRequest,
): Promise<ResolvedChatModel> {
  if (model !== AUTO_MODEL_ID) {
    return { effectiveModel: model, scoredFallbacks: [] };
  }

  const { resolveAutoModel } = await import("../../../agent/auto-select.ts");
  const query = body.messages?.find((m) => m.role === "user")?.content ?? "";
  const autoDecision = await resolveAutoModel(
    typeof query === "string" ? query : "",
  );
  return {
    effectiveModel: autoDecision.model,
    scoredFallbacks: autoDecision.fallbacks,
    autoSelectionReason: autoDecision.reason,
  };
}

function emitAutoSelectionTrace(
  resolvedModel: ResolvedChatModel,
  emit: (obj: unknown) => void,
): void {
  if (!resolvedModel.autoSelectionReason) return;
  emit({
    event: "trace",
    trace: {
      type: "auto_select",
      model: resolvedModel.effectiveModel ?? AUTO_MODEL_ID,
      fallbacks: resolvedModel.scoredFallbacks,
      reason: resolvedModel.autoSelectionReason,
    },
  });
}

/** Drain a token iterator with abort support, forwarding each chunk. */
async function drainTokenStream(
  tokenIterator: AsyncIterator<string>,
  signal: AbortSignal,
  onChunk: (token: string) => void,
): Promise<string> {
  const fullText = new TextAccumulator();
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
      fullText.append(token);
      onChunk(token);
    }
  } finally {
    try {
      await tokenIterator.return?.();
    } catch { /* already closed */ }
  }

  return fullText.text;
}

function createChatTokenIterator(
  providerMessages: Awaited<
    ReturnType<typeof buildChatProviderMessages>
  >["messages"],
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
  providerMessages: Awaited<
    ReturnType<typeof buildChatProviderMessages>
  >["messages"],
  resolvedModel: string | undefined,
  body: ChatRequest,
  signal: AbortSignal,
  emit: (obj: unknown) => void,
  onChunk: (token: string) => void,
  weakContextRawLimit?: number,
  scoredFallbacks: string[] = [],
): Promise<string> {
  const localFallbackModelId = await resolveLocalFallbackModelId();
  if (
    resolvedModel === localFallbackModelId && !(await isLocalFallbackReady())
  ) {
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
      createChatTokenIterator(
        providerMessages,
        model,
        body,
        weakContextRawLimit,
        signal,
      ),
      signal,
      forwardChunk,
    );

  return withFallbackChain<string>({
    primaryModel: resolvedModel,
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
      : { model: localFallbackModelId, isAvailable: isLocalFallbackReady },
    tryLastResort: (model) => {
      emit({ event: "warning", message: LOCAL_FALLBACK_RETRY_MESSAGE });
      return tryStream(model);
    },
    onModelFailure: async (model, err) => {
      await recordAutoModelFailure(model, err);
    },
    onLastResortUnavailable: (err) => {
      throw new RuntimeError(localFallbackPreparingMessage(resolvedModel), {
        originalError: err instanceof Error ? err : undefined,
      });
    },
  });
}

function getChatSystemPrompt(): string {
  return compilePrompt({
    mode: "chat",
    capability: "agent",
    tools: {},
  }).text;
}

function buildCapturedContextSystemMessage(
  capturedContexts: ChatRequest["captured_contexts"],
) {
  if (!capturedContexts?.length) return null;

  const toPromptEntry = (
    context: NonNullable<ChatRequest["captured_contexts"]>[number],
  ) => {
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
  preResolvedModel?: ResolvedChatModel,
  mirrorToGuiLiveTranscript = false,
): Promise<void> {
  const chatModel = preResolvedModel ??
    await resolveChatModelForRequest(resolvedModel, body);
  if (!preResolvedModel) {
    emitAutoSelectionTrace(chatModel, emit);
  }
  const { effectiveModel, scoredFallbacks } = chatModel;

  const requestOverridesStoredHistory = shouldHonorRequestMessages(
    body.messages,
  );
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
    const insertionIndex = lastUserIndex >= 0
      ? lastUserIndex
      : providerMessages.length;
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
    const runtimeMessage = updatedAssistant
      ? await toRuntimeSessionMessage(updatedAssistant)
      : {
        id: assistantMessageId,
        content: fullText,
      };
    pushSSEEvent(sessionId, "message_updated", {
      message: runtimeMessage,
    });
    if (mirrorToGuiLiveTranscript) {
      pushGuiLiveTranscriptEvent("message_updated", {
        message: runtimeMessage,
      });
    }
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
  const chatModel = await resolveChatModelForRequest(resolvedModel, body);
  emitAutoSelectionTrace(chatModel, emit);
  const { effectiveModel, scoredFallbacks } = chatModel;

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
