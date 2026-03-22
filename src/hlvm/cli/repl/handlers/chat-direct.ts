/**
 * Direct chat mode: streaming LLM responses, model validation.
 * Extracted from chat.ts for modularity.
 */

import { ai } from "../../../api/ai.ts";
import { updateMessage } from "../../../store/conversation-store.ts";
import { pushSSEEvent } from "../../../store/sse-store.ts";
import { config } from "../../../api/config.ts";
import { loadAllMessages } from "../../../store/message-utils.ts";
import type { ModelInfo } from "../../../providers/types.ts";
import { pushConversationUpdatedEvent, type ChatRequest } from "./chat-session.ts";
import {
  buildChatProviderMessages,
  shouldHonorRequestMessages,
} from "./chat-context.ts";
import { compilePrompt, EMPTY_INSTRUCTIONS } from "../../../prompt/mod.ts";

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
  modelInfo?: ModelInfo | null,
): Promise<void> {
  const storedMessages = shouldHonorRequestMessages(body.messages)
    ? []
    : loadAllMessages(sessionId);
  const { messages: providerMessages } = await buildChatProviderMessages({
    requestMessages: body.messages,
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

  const cfgSnapshot = config.snapshot;
  const tokenIterator = ai.chat(providerMessages, {
    model: resolvedModel,
    temperature: body.temperature ?? cfgSnapshot.temperature,
    maxTokens: body.max_tokens ?? cfgSnapshot.maxTokens,
    signal,
  })[Symbol.asyncIterator]();

  const fullText = await drainTokenStream(tokenIterator, signal, (token) => {
    onPartial(token);
    emit({ event: "token", text: token });
  });

  if (!signal.aborted) {
    updateMessage(assistantMessageId, { content: fullText });
    pushSSEEvent(sessionId, "message_updated", {
      id: assistantMessageId,
      content: fullText,
    });
    pushConversationUpdatedEvent(sessionId);
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
  const cfgSnapshot = config.snapshot;
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

  const tokenIterator = ai.chat(providerMessages, {
    model: resolvedModel,
    temperature: body.temperature ?? cfgSnapshot.temperature,
    maxTokens: body.max_tokens ?? cfgSnapshot.maxTokens,
    signal,
  })[Symbol.asyncIterator]();

  return drainTokenStream(tokenIterator, signal, (token) => {
    onPartial(token);
    emit({ event: "token", text: token });
  });
}
