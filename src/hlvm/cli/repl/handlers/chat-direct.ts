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
import { insertFact, linkFactEntities } from "../../../memory/mod.ts";
import {
  findSnapshotBackedModel,
  listSnapshotBackedModels,
} from "../../model-discovery.ts";
import type { ChatRequest } from "./chat-session.ts";
import {
  CHAT_CONTEXT_HISTORY_LIMIT,
  pushSessionUpdatedEvent,
} from "./chat-session.ts";
import {
  buildChatProviderMessages,
  shouldHonorRequestMessages,
} from "./chat-context.ts";

// ============================================================
// Auto-save heuristic patterns (module-level to avoid per-call allocation)
// ============================================================

const NAME_PATTERNS: RegExp[] = [
  /my name is\s+(.{2,40})/i,
  /i'?m\s+([A-Za-z][\w]+(?:\s+[A-Za-z][\w]+){0,3})/i,
  /call me\s+(.{2,30})/i,
];

const PREF_PATTERNS: RegExp[] = [
  /i (?:prefer|like|use|want|need)\s+(.{3,80})/i,
  /(?:remember|don'?t forget)\s+(?:that\s+)?(.{5,120})/i,
];

/** Words that follow "I'm" but are NOT names (prevents false positives) */
const NOT_NAMES = new Set([
  "thinking",
  "wondering",
  "looking",
  "trying",
  "going",
  "working",
  "happy",
  "sorry",
  "sure",
  "glad",
  "fine",
  "good",
  "great",
  "okay",
  "confused",
  "interested",
  "curious",
  "new",
  "here",
  "back",
  "done",
  "not",
  "a",
  "the",
  "just",
  "also",
  "really",
  "very",
]);

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

    // Auto-persist important user facts to memory (best-effort, non-blocking)
    const userContent = body.messages?.[body.messages.length - 1]?.content ??
      "";
    autoSaveUserFacts(userContent, fullText);
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

/**
 * Auto-save important user facts from chat conversations to persistent memory.
 * Since plain chat has no memory tool, this remains a lightweight user-message
 * heuristic rather than a full semantic extractor.
 *
 * Patterns detected:
 * - "my name is X" / "I'm X" / "call me X"
 * - "I prefer X" / "I like X" / "I use X"
 * - "remember that X" / "don't forget X"
 *
 * Writes to canonical memory DB.
 */
function autoSaveUserFacts(
  userMessage: string,
  _assistantResponse: string,
): void {
  if (!userMessage || userMessage.length < 5) return;

  const lower = userMessage.toLowerCase();
  const facts: string[] = [];

  // Name patterns
  for (const pattern of NAME_PATTERNS) {
    const match = userMessage.match(pattern);
    if (match) {
      const firstWord = match[1].trim().toLowerCase().split(/\s/)[0];
      if (NOT_NAMES.has(firstWord)) continue;
      facts.push(`User's name: ${match[1].trim().replace(/[.!?,;]+$/, "")}`);
      break;
    }
  }

  // Preference patterns
  for (const pattern of PREF_PATTERNS) {
    const match = lower.match(pattern);
    if (match) {
      // Use original casing from userMessage at the matched position
      const idx = lower.indexOf(match[0]);
      const original = userMessage.slice(idx, idx + match[0].length);
      facts.push(original.charAt(0).toUpperCase() + original.slice(1));
      break;
    }
  }

  if (facts.length === 0) return;

  const entry = facts.join("\n");
  try {
    const factId = insertFact({
      content: entry,
      category: "Preferences",
      source: "memory",
    });
    linkFactEntities(factId, entry);
    log.debug(`Auto-saved ${facts.length} fact(s) to memory from chat`);
  } catch {
    log.debug("Failed to auto-save facts to memory");
  }
}
