/**
 * Direct chat mode: streaming LLM responses, model validation.
 * Extracted from chat.ts for modularity.
 */

import { ai } from "../../../api/ai.ts";
import { updateMessage } from "../../../store/conversation-store.ts";
import { pushSSEEvent } from "../../../store/sse-store.ts";
import { config } from "../../../api/config.ts";
import { log } from "../../../api/log.ts";
import { loadAllMessages } from "../../../store/message-utils.ts";
import type { ModelInfo } from "../../../providers/types.ts";
import { CLI_CACHE_TTL_MS } from "../../repl-ink/ui-constants.ts";
import { persistConversationFacts } from "../../../memory/mod.ts";
import {
  findSnapshotBackedModel,
  listSnapshotBackedModels,
} from "../../model-discovery.ts";
import type { ChatRequest } from "./chat-session.ts";
import {
  pushSessionUpdatedEvent,
} from "./chat-session.ts";
import {
  buildChatProviderMessages,
  shouldHonorRequestMessages,
} from "./chat-context.ts";

/** Cached catalog result with TTL */
let _catalogCache: {
  data: ModelInfo[];
  expiry: number;
} | null = null;

export async function modelSupportsTools(
  modelName: string,
  modelInfo: ModelInfo | null,
): Promise<{ supported: boolean; catalogFailed?: boolean }> {
  if (modelInfo?.capabilities) {
    return { supported: modelInfo.capabilities.includes("tools") };
  }
  try {
    const now = Date.now();
    if (!_catalogCache || now > _catalogCache.expiry) {
      _catalogCache = {
        data: await listSnapshotBackedModels({
          includeRemoteCatalog: true,
        }),
        expiry: now + CLI_CACHE_TTL_MS,
      };
    }
    const match = findSnapshotBackedModel(_catalogCache.data, modelName);
    if (match) {
      return { supported: match.capabilities?.includes("tools") ?? false };
    }
  } catch (e) {
    log.warn("Model catalog unavailable for tool support check", e);
    return { supported: false, catalogFailed: true };
  }
  return { supported: false };
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
    modelInfo,
    modelKey: resolvedModel,
  });

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

    // Persist baseline conversation facts through the shared memory pipeline.
    const userContent = body.messages?.[body.messages.length - 1]?.content ??
      "";
    persistConversationFacts([{ role: "user", content: userContent }], {
      source: "extracted",
    });
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
    modelInfo,
    modelKey: resolvedModel,
  });

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
