/**
 * Direct chat mode: streaming LLM responses, model validation.
 * Extracted from chat.ts for modularity.
 */

import { ai } from "../../../api/ai.ts";
import {
  updateMessage,
} from "../../../store/conversation-store.ts";
import { pushSSEEvent } from "../../../store/sse-store.ts";
import { config } from "../../../api/config.ts";
import { log } from "../../../api/log.ts";
import { loadRecentMessages } from "../../../store/message-utils.ts";
import { type Message } from "../../../providers/index.ts";
import type { ModelInfo } from "../../../providers/types.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import type { ChatRequest } from "./chat-session.ts";
import {
  CHAT_CONTEXT_HISTORY_LIMIT,
  pushSessionUpdatedEvent,
} from "./chat-session.ts";

/** Cached catalog result with TTL */
let _catalogCache: {
  data: Awaited<ReturnType<typeof ai.models.catalog>>;
  expiry: number;
} | null = null;
const CATALOG_CACHE_TTL_MS = 60_000;

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

export async function streamDirectChatFallback(
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
  } catch (e) {
    log.warn(`Failed to read image: ${filePath}`, e);
    return null;
  }
}

async function resolveImages(
  imagePathsJson: string | null,
): Promise<string[]> {
  if (!imagePathsJson) return [];
  try {
    const paths: string[] = JSON.parse(imagePathsJson);
    const images: string[] = [];
    for (const p of paths) {
      const base64 = await readImageAsBase64(p);
      if (base64) images.push(base64);
    }
    return images;
  } catch (e) {
    log.warn("Failed to resolve image paths", e);
    return [];
  }
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
