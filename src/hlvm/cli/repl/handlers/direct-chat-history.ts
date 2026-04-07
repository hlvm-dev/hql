import { truncate, truncateMiddle } from "../../../../common/utils.ts";
import { OUTPUT_RESERVE_TOKENS } from "../../../agent/constants.ts";
import { type Message as AgentMessage } from "../../../agent/context.ts";
import {
  resolveContextBudget,
  type ResolvedBudget,
} from "../../../agent/context-resolver.ts";
import {
  classifyModelTier,
  isFrontierProvider,
} from "../../../agent/constants.ts";
import { log } from "../../../api/log.ts";
import type { ModelInfo } from "../../../providers/types.ts";
import { getMessages, getSession } from "../../../store/conversation-store.ts";
import { loadRecentMessages, parseStoredStringArray } from "../../../store/message-utils.ts";
import {
  parseSessionMetadata,
  updateSessionMetadata,
} from "../../../store/session-metadata.ts";
import type { MessageRow } from "../../../store/types.ts";

const DIRECT_CHAT_METADATA_KEY = "directChat";
const WEAK_DIRECT_CHAT_RECENT_GROUPS = 6;
const WEAK_DIRECT_CHAT_RECENT_FETCH_LIMIT = 160;
const WEAK_DIRECT_CHAT_SUMMARY_MAX_CHARS = 2_400;
const SUMMARY_FETCH_PAGE_SIZE = 200;

interface PersistedDirectChatMetadata {
  rollingSummary?: string;
  summarizedThroughOrder?: number;
  summaryUpdatedAt?: string;
}

interface WeakDirectChatContext {
  storedMessages: MessageRow[];
  prependReplayMessages?: AgentMessage[];
  resolvedContextBudget: ResolvedBudget;
  historyStrategy: "summary_recent";
  summaryChars: number;
  summarizedThroughOrder: number;
  recentRawGroupCount: number;
  weakContextBudget: number;
}

const weakDirectChatSummaryJobs = new Map<string, {
  rerunRequested: boolean;
  cancelled: boolean;
}>();

function parseDirectChatMetadata(
  metadata: string | null | undefined,
): PersistedDirectChatMetadata {
  const parsed = parseSessionMetadata(metadata);
  const record = parsed[DIRECT_CHAT_METADATA_KEY];
  if (!record || typeof record !== "object") {
    return {};
  }
  const directChat = record as Record<string, unknown>;
  return {
    rollingSummary: typeof directChat.rollingSummary === "string" &&
        directChat.rollingSummary.trim().length > 0
      ? directChat.rollingSummary
      : undefined,
    summarizedThroughOrder:
      typeof directChat.summarizedThroughOrder === "number" &&
        Number.isFinite(directChat.summarizedThroughOrder)
        ? directChat.summarizedThroughOrder
        : undefined,
    summaryUpdatedAt: typeof directChat.summaryUpdatedAt === "string"
      ? directChat.summaryUpdatedAt
      : undefined,
  };
}

function updateDirectChatMetadata(
  sessionId: string,
  mutate: (metadata: PersistedDirectChatMetadata) => void,
): void {
  updateSessionMetadata(sessionId, (existing) => {
    const metadata = parseDirectChatMetadata(JSON.stringify(existing));
    mutate(metadata);
    existing[DIRECT_CHAT_METADATA_KEY] = metadata;
  });
}

function parseParameterCountInBillions(
  parameterSize?: string,
): number | undefined {
  if (!parameterSize) {
    return undefined;
  }
  const match = parameterSize.match(/^(\d+(?:\.\d+)?)\s*([bBmM])/);
  if (!match) {
    return undefined;
  }
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return match[2].toLowerCase() === "m" ? value / 1000 : value;
}

export function isWeakLocalDirectChatModel(
  modelKey?: string,
  modelInfo?: ModelInfo | null,
): boolean {
  return !isFrontierProvider(modelKey) &&
    classifyModelTier(modelInfo) === "constrained";
}

export function resolveWeakDirectChatBudget(
  modelInfo?: ModelInfo | null,
): ResolvedBudget {
  const parameterBillions = parseParameterCountInBillions(modelInfo?.parameterSize);
  const targetBudget = parameterBillions !== undefined && parameterBillions <= 4
    ? 3_000
    : 6_000;
  const providerBudget = resolveContextBudget({
    modelInfo: modelInfo ?? undefined,
  });
  if (providerBudget.source === "model_info") {
    const budget = Math.min(targetBudget, providerBudget.budget);
    return {
      budget,
      rawLimit: Math.min(
        providerBudget.rawLimit,
        budget + OUTPUT_RESERVE_TOKENS,
      ),
      source: "model_info",
    };
  }
  return {
    budget: targetBudget,
    rawLimit: targetBudget + OUTPUT_RESERVE_TOKENS,
    source: "default",
  };
}

function buildStoredRequestGroups(messages: readonly MessageRow[]): MessageRow[][] {
  const groups: MessageRow[][] = [];
  for (let index = 0; index < messages.length; index++) {
    const current = messages[index];
    const requestId = current.request_id;
    const group: MessageRow[] = [current];
    if (!requestId) {
      groups.push(group);
      continue;
    }
    while (
      index + 1 < messages.length &&
      messages[index + 1].request_id === requestId
    ) {
      group.push(messages[index + 1]);
      index++;
    }
    groups.push(group);
  }
  return groups;
}

function summarizeStoredMessageBody(message: MessageRow): string {
  const attachmentCount = parseStoredStringArray(message.attachment_ids)?.length ?? 0;
  const attachmentMarker = attachmentCount > 0
    ? ` [attachments: ${attachmentCount}]`
    : "";
  const trimmedContent = message.content.trim();
  if (trimmedContent.length === 0) {
    if (message.role === "tool") {
      return `${message.tool_name ?? "tool"} result${attachmentMarker}`.trim();
    }
    return attachmentMarker.trim();
  }
  return `${truncateMiddle(trimmedContent, 240)}${attachmentMarker}`.trim();
}

function buildRollingSummary(
  previousSummary: string | undefined,
  messages: readonly MessageRow[],
): string {
  const lines: string[] = [];
  if (previousSummary?.trim()) {
    lines.push("Earlier summary:");
    lines.push(previousSummary.trim());
    lines.push("");
  }
  lines.push("Additional older conversation:");
  for (const message of messages) {
    const body = summarizeStoredMessageBody(message);
    if (!body) {
      continue;
    }
    const label = message.role === "tool"
      ? `Tool${message.tool_name ? ` (${message.tool_name})` : ""}`
      : message.role === "assistant"
      ? "Assistant"
      : message.role === "system"
      ? "System"
      : "User";
    lines.push(`- ${label}: ${body}`);
  }
  return truncate(lines.join("\n"), WEAK_DIRECT_CHAT_SUMMARY_MAX_CHARS);
}

function buildSummaryReplayMessage(
  summary: string | undefined,
): AgentMessage[] | undefined {
  if (!summary?.trim()) {
    return undefined;
  }
  return [{
    role: "assistant",
    content: `Summary of earlier context:\n${summary.trim()}`,
  }];
}

function loadRecentWeakDirectChatStoredMessages(
  sessionId: string,
): { messages: MessageRow[]; recentRawGroupCount: number } {
  const recentMessages = loadRecentMessages(
    sessionId,
    WEAK_DIRECT_CHAT_RECENT_FETCH_LIMIT,
  );
  const groups = buildStoredRequestGroups(recentMessages);
  const rawMessages = groups.slice(-WEAK_DIRECT_CHAT_RECENT_GROUPS).flatMap((group) =>
    group
  );
  return {
    messages: rawMessages,
    recentRawGroupCount: Math.min(WEAK_DIRECT_CHAT_RECENT_GROUPS, groups.length),
  };
}

async function loadUnsummarizedPrefixMessages(options: {
  sessionId: string;
  summarizedThroughOrder?: number;
  beforeOrderExclusive: number;
}): Promise<MessageRow[]> {
  if (options.beforeOrderExclusive <= 0) {
    return [];
  }
  const messages: MessageRow[] = [];
  let afterOrder = options.summarizedThroughOrder;
  while (true) {
    const result = getMessages(options.sessionId, {
      limit: SUMMARY_FETCH_PAGE_SIZE,
      sort: "asc",
      ...(afterOrder !== undefined ? { after_order: afterOrder } : {}),
    });
    if (result.messages.length === 0) {
      break;
    }
    let reachedBoundary = false;
    for (const message of result.messages) {
      if (message.order >= options.beforeOrderExclusive) {
        reachedBoundary = true;
        break;
      }
      messages.push(message);
    }
    if (reachedBoundary || !result.has_more) {
      break;
    }
    afterOrder = result.messages[result.messages.length - 1]?.order;
  }
  return messages;
}

async function compactWeakDirectChatHistoryOnce(
  sessionId: string,
  isCancelled: () => boolean,
): Promise<void> {
  if (isCancelled()) {
    return;
  }
  const recent = loadRecentWeakDirectChatStoredMessages(sessionId);
  const firstRecentOrder = recent.messages[0]?.order;
  if (!firstRecentOrder || firstRecentOrder <= 1) {
    return;
  }
  const currentMetadata = parseDirectChatMetadata(getSession(sessionId)?.metadata);
  const sessionMessages = await loadUnsummarizedPrefixMessages({
    sessionId,
    summarizedThroughOrder: currentMetadata.summarizedThroughOrder,
    beforeOrderExclusive: firstRecentOrder,
  });
  if (sessionMessages.length === 0) {
    return;
  }
  const nextSummary = buildRollingSummary(
    currentMetadata.rollingSummary,
    sessionMessages,
  );
  const summarizedThroughOrder = sessionMessages[sessionMessages.length - 1]?.order;
  if (isCancelled() || !summarizedThroughOrder || nextSummary.trim().length === 0) {
    return;
  }
  updateDirectChatMetadata(sessionId, (metadata) => {
    metadata.rollingSummary = nextSummary;
    metadata.summarizedThroughOrder = summarizedThroughOrder;
    metadata.summaryUpdatedAt = new Date().toISOString();
  });
}

export function scheduleWeakDirectChatSummaryMaintenance(
  sessionId: string,
): void {
  const existing = weakDirectChatSummaryJobs.get(sessionId);
  if (existing) {
    existing.rerunRequested = true;
    return;
  }
  const state = {
    rerunRequested: false,
    cancelled: false,
  };
  weakDirectChatSummaryJobs.set(sessionId, state);
  void (async () => {
    try {
      do {
        state.rerunRequested = false;
        try {
          await compactWeakDirectChatHistoryOnce(
            sessionId,
            () => state.cancelled,
          );
        } catch (error) {
          log.debug("Weak direct-chat summary maintenance failed", error);
        }
      } while (state.rerunRequested && !state.cancelled);
    } finally {
      weakDirectChatSummaryJobs.delete(sessionId);
    }
  })();
}

export function clearWeakDirectChatSummaryState(
  sessionId: string,
): void {
  const state = weakDirectChatSummaryJobs.get(sessionId);
  if (state) {
    state.cancelled = true;
    weakDirectChatSummaryJobs.delete(sessionId);
  }
  updateDirectChatMetadata(sessionId, (metadata) => {
    metadata.rollingSummary = undefined;
    metadata.summarizedThroughOrder = undefined;
    metadata.summaryUpdatedAt = undefined;
  });
}

export function buildWeakDirectChatContext(
  sessionId: string,
  sessionMetadata: string | null | undefined,
  modelInfo?: ModelInfo | null,
): WeakDirectChatContext {
  const metadata = parseDirectChatMetadata(sessionMetadata);
  const recent = loadRecentWeakDirectChatStoredMessages(sessionId);
  const resolvedContextBudget = resolveWeakDirectChatBudget(modelInfo);
  return {
    storedMessages: recent.messages,
    prependReplayMessages: buildSummaryReplayMessage(metadata.rollingSummary),
    resolvedContextBudget,
    historyStrategy: "summary_recent",
    summaryChars: metadata.rollingSummary?.length ?? 0,
    summarizedThroughOrder: metadata.summarizedThroughOrder ?? 0,
    recentRawGroupCount: recent.recentRawGroupCount,
    weakContextBudget: resolvedContextBudget.budget,
  };
}
