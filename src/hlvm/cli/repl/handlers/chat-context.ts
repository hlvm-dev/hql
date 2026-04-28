/**
 * Shared chat/agent transcript assembly.
 *
 * SSOT for:
 * - deciding when request messages override stored session history
 * - normalizing stored/request messages into replayable context
 * - preserving attachments across chat and agent replay
 * - injecting memory + model-aware trimming for plain chat
 * - reconstructing prior tool observations for HTTP agent follow-up turns
 */

import { getContextWindow } from "../../../../common/config/selectors.ts";
import { isObjectValue } from "../../../../common/utils.ts";
import { config } from "../../../api/config.ts";
import { log } from "../../../api/log.ts";
import {
  ContextManager,
  type Message as AgentMessage,
  takeLastMessageGroups,
} from "../../../agent/context.ts";
import {
  resolveContextBudget,
  type ResolvedBudget,
} from "../../../agent/context-resolver.ts";
import { loadMemorySystemMessage } from "../../../memory/memdir.ts";
import type {
  Message as ProviderMessage,
  ModelInfo,
  ProviderToolCall,
} from "../../../providers/types.ts";
import { parseStoredStringArray } from "../../../store/message-utils.ts";
import type { MessageRow } from "../../../store/types.ts";
import { materializeConversationAttachments } from "../../../attachments/service.ts";
import type {
  ConversationAttachmentMaterializationOptions,
  ConversationAttachmentPayload,
} from "../../../attachments/types.ts";
import {
  getConversationMaterializationOptionsForModel,
} from "../../attachment-policy.ts";
import type { ChatRequest } from "./chat-session.ts";

type ReplayMessage = AgentMessage;

interface BuildReplayMessagesOptions {
  requestMessages: ChatRequest["messages"];
  storedMessages: MessageRow[];
  assistantMessageId?: number;
  attachmentMaterializationOptions?:
    ConversationAttachmentMaterializationOptions;
}

interface BuildChatProviderMessagesOptions extends BuildReplayMessagesOptions {
  disablePersistentMemory?: boolean;
  modelInfo?: ModelInfo | null;
  modelKey?: string;
  prependReplayMessages?: ReplayMessage[];
  contextBudgetOverride?: ResolvedBudget;
}

interface BuildAgentHistoryOptions extends BuildReplayMessagesOptions {
  maxGroups: number;
  modelKey?: string;
  modelInfo?: ModelInfo | null;
}

interface BuildStoredAgentHistoryOptions {
  storedMessages: MessageRow[];
  assistantMessageId?: number;
  maxGroups: number;
  modelKey?: string;
  modelInfo?: ModelInfo | null;
}

interface BuildChatProviderMessagesResult {
  messages: ProviderMessage[];
  resolvedContextBudget: ResolvedBudget;
}

interface PersistableRequestMessage {
  role: "system" | "user" | "assistant";
  content: string;
  displayContent?: string;
  attachmentIds?: string[];
  clientTurnId?: string;
  senderType: "system" | "user" | "llm";
}

const HISTORICAL_TOOL_ARG = { historicalReplay: true };

export function shouldHonorRequestMessages(
  messages: ChatRequest["messages"],
): boolean {
  if (messages.length !== 1) return true;
  return messages[0]?.role !== "user";
}

export async function buildReplayMessages(
  options: BuildReplayMessagesOptions,
): Promise<ReplayMessage[]> {
  if (shouldHonorRequestMessages(options.requestMessages)) {
    return await normalizeRequestMessages(
      options.requestMessages,
      options.attachmentMaterializationOptions,
    );
  }
  return await normalizeStoredMessages(
    options.storedMessages,
    options.assistantMessageId,
    options.attachmentMaterializationOptions,
  );
}

export function validateChatRequestMessages(
  messages: ChatRequest["messages"],
): string | null {
  const currentMessage = messages[messages.length - 1];
  if (!currentMessage || currentMessage.role !== "user") {
    return "Last message must be a user turn";
  }
  return null;
}

export function buildRequestMessagesToPersist(
  options: {
    requestMessages: ChatRequest["messages"];
    storedMessages: MessageRow[];
    fallbackClientTurnId?: string;
  },
): PersistableRequestMessage[] {
  const currentMessage =
    options.requestMessages[options.requestMessages.length - 1];
  if (!currentMessage || currentMessage.role !== "user") {
    return [];
  }

  if (!shouldHonorRequestMessages(options.requestMessages)) {
    return [
      normalizeCurrentUserMessage(currentMessage, options.fallbackClientTurnId),
    ];
  }

  const requestTranscript = normalizeRequestMessagesForPersistence(
    options.requestMessages,
    options.fallbackClientTurnId,
  );
  if (requestTranscript.length === 0) return [];

  const storedTranscript = normalizeStoredMessagesForPersistence(
    options.storedMessages,
  );
  const overlap = findTranscriptOverlap(storedTranscript, requestTranscript);
  return requestTranscript.slice(overlap);
}

export async function buildChatProviderMessages(
  options: BuildChatProviderMessagesOptions,
): Promise<BuildChatProviderMessagesResult> {
  const attachmentMaterializationOptions =
    await getConversationMaterializationOptionsForModel(
      options.modelKey ?? "",
      options.modelInfo ?? null,
    );
  const replayMessages = await buildReplayMessages({
    ...options,
    attachmentMaterializationOptions,
  });
  const resolvedContextBudget = options.contextBudgetOverride ??
    resolveChatContextBudget(
      options.modelInfo,
      options.modelKey,
    );
  const replayWithPrefix = options.prependReplayMessages?.length
    ? [...options.prependReplayMessages, ...replayMessages]
    : replayMessages;
  const replayWithMemory = await injectGlobalReplayMessages(
    replayWithPrefix,
    resolvedContextBudget.budget,
    options.requestMessages[options.requestMessages.length - 1]?.content ?? "",
    !options.disablePersistentMemory,
  );
  const trimmed = trimReplayMessages(
    replayWithMemory,
    resolvedContextBudget.budget,
    options.modelKey,
  );
  return {
    messages: toProviderReplayMessages(trimmed),
    resolvedContextBudget,
  };
}

export async function buildAgentHistoryMessages(
  options: BuildAgentHistoryOptions,
): Promise<AgentMessage[]> {
  const attachmentMaterializationOptions =
    await getConversationMaterializationOptionsForModel(
      options.modelKey ?? "",
      options.modelInfo ?? null,
    );
  const replayMessages = await buildReplayMessages({
    ...options,
    attachmentMaterializationOptions,
  });
  return buildAgentHistoryFromReplayMessages(
    replayMessages,
    options.maxGroups,
    options.modelKey,
  );
}

export async function buildStoredAgentHistoryMessages(
  options: BuildStoredAgentHistoryOptions,
): Promise<AgentMessage[]> {
  const replayMessages = await normalizeStoredMessages(
    options.storedMessages,
    options.assistantMessageId,
    await getConversationMaterializationOptionsForModel(
      options.modelKey ?? "",
      options.modelInfo ?? null,
    ),
  );
  return buildAgentHistoryFromReplayMessages(
    replayMessages,
    options.maxGroups,
    options.modelKey,
  );
}

function buildAgentHistoryFromReplayMessages(
  replayMessages: ReplayMessage[],
  maxGroups: number,
  modelKey?: string,
): AgentMessage[] {
  const normalized = normalizeReplayMessagesForAgent(replayMessages);
  const filtered = normalized.filter(isReplayableAgentMessage);
  return takeLastMessageGroups(filtered, maxGroups, modelKey);
}

export function resolveChatContextBudget(
  modelInfo?: ModelInfo | null,
  _modelKey?: string,
): ResolvedBudget {
  return resolveContextBudget({
    modelInfo: modelInfo ?? undefined,
    userOverride: getContextWindow(config.snapshot),
  });
}

export function trimReplayMessages(
  messages: ReplayMessage[],
  maxTokens: number,
  modelKey?: string,
): ReplayMessage[] {
  const context = new ContextManager({
    maxTokens,
    minMessages: 1,
    preserveSystem: true,
    overflowStrategy: "trim",
    modelKey,
  });
  for (const message of messages) {
    context.addMessage({ ...message });
  }
  return context.getMessages().map((message) => ({ ...message }));
}

async function normalizeRequestMessages(
  messages: ChatRequest["messages"],
  attachmentMaterializationOptions?:
    ConversationAttachmentMaterializationOptions,
): Promise<ReplayMessage[]> {
  const replayMessages: ReplayMessage[] = [];
  for (const message of messages) {
    const replayMessage = await createReplayMessage({
      role: message.role,
      content: message.content,
      attachmentIds: message.attachment_ids,
      attachmentMaterializationOptions,
    });
    if (isReplayableReplayMessage(replayMessage)) {
      replayMessages.push(replayMessage);
    }
  }
  return replayMessages;
}

async function normalizeStoredMessages(
  storedMessages: MessageRow[],
  assistantMessageId?: number,
  attachmentMaterializationOptions?:
    ConversationAttachmentMaterializationOptions,
): Promise<ReplayMessage[]> {
  const orderedMessages = reorderStoredMessages(
    storedMessages,
    assistantMessageId,
  );
  const replayMessages: ReplayMessage[] = [];
  for (const message of orderedMessages) {
    const replayMessage = await createReplayMessage({
      role: message.role,
      content: message.content,
      attachmentIds: parseAttachmentIds(message.attachment_ids),
      toolCalls: parseToolCalls(message.tool_calls),
      toolName: message.tool_name ?? undefined,
      toolCallId: message.tool_call_id ?? undefined,
      attachmentMaterializationOptions,
    });
    if (isReplayableReplayMessage(replayMessage)) {
      replayMessages.push(replayMessage);
    }
  }
  return replayMessages;
}

function reorderStoredMessages(
  storedMessages: MessageRow[],
  assistantMessageId?: number,
): MessageRow[] {
  const ordered: MessageRow[] = [];
  let index = 0;

  while (index < storedMessages.length) {
    const current = storedMessages[index];
    if (!current.request_id) {
      if (shouldIncludeStoredMessage(current, assistantMessageId)) {
        ordered.push(current);
      }
      index++;
      continue;
    }

    let end = index + 1;
    while (
      end < storedMessages.length &&
      storedMessages[end].request_id === current.request_id
    ) {
      end++;
    }

    const requestGroup = storedMessages.slice(index, end);
    if (requestGroupHasCancelledMessage(requestGroup)) {
      index = end;
      continue;
    }

    const group = requestGroup.filter((message) =>
      shouldIncludeStoredMessage(message, assistantMessageId)
    );
    ordered.push(...reorderRequestGroup(group));
    index = end;
  }

  return ordered;
}

function reorderRequestGroup(group: MessageRow[]): MessageRow[] {
  if (group.length <= 1) return group;
  const hasTools = group.some((message) => message.role === "tool");
  if (!hasTools) return group;

  const leadingMessages = group.filter((message) =>
    message.role === "system" || message.role === "user"
  );
  const assistantToolCallMessages = group.filter((message) =>
    message.role === "assistant" && !!message.tool_calls
  );
  const toolMessages = group.filter((message) => message.role === "tool");
  const assistantTextMessages = group.filter((message) =>
    message.role === "assistant" && !message.tool_calls
  );

  return [
    ...leadingMessages,
    ...assistantToolCallMessages,
    ...toolMessages,
    ...assistantTextMessages,
  ];
}

function shouldIncludeStoredMessage(
  message: MessageRow,
  assistantMessageId?: number,
): boolean {
  if (message.cancelled) return false;
  if (assistantMessageId !== undefined && message.id === assistantMessageId) {
    return false;
  }
  if (message.role === "tool") {
    return message.content.length > 0 || !!message.tool_name;
  }
  if (message.tool_calls) return true;
  if (
    message.attachment_ids
  ) {
    return true;
  }
  return message.content.length > 0;
}

function requestGroupHasCancelledMessage(
  group: readonly MessageRow[],
): boolean {
  return group.some((message) => message.cancelled !== 0);
}

function normalizeCurrentUserMessage(
  message: ChatRequest["messages"][number],
  fallbackClientTurnId?: string,
): PersistableRequestMessage {
  return {
    role: "user",
    content: message.content,
    displayContent: message.display_content,
    attachmentIds: sanitizeAttachmentIds(message.attachment_ids),
    clientTurnId: message.client_turn_id ?? fallbackClientTurnId,
    senderType: "user",
  };
}

function normalizeRequestMessagesForPersistence(
  messages: ChatRequest["messages"],
  fallbackClientTurnId?: string,
): PersistableRequestMessage[] {
  const persistable: PersistableRequestMessage[] = [];
  const lastIndex = messages.length - 1;

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === "tool") continue;

    const attachmentIds = sanitizeAttachmentIds(message.attachment_ids);
    if (message.content.length === 0 && attachmentIds === undefined) {
      continue;
    }

    persistable.push({
      role: message.role,
      content: message.content,
      displayContent: message.display_content,
      attachmentIds,
      clientTurnId: message.client_turn_id ??
        (message.role === "user" && index === lastIndex
          ? fallbackClientTurnId
          : undefined),
      senderType: getPersistedSenderType(message.role),
    });
  }

  return persistable;
}

function normalizeStoredMessagesForPersistence(
  storedMessages: MessageRow[],
): PersistableRequestMessage[] {
  const persistable: PersistableRequestMessage[] = [];
  let index = 0;

  while (index < storedMessages.length) {
    const current = storedMessages[index];
    if (!current.request_id) {
      appendStoredMessageForPersistence(current, persistable);
      index++;
      continue;
    }

    let end = index + 1;
    while (
      end < storedMessages.length &&
      storedMessages[end].request_id === current.request_id
    ) {
      end++;
    }

    const requestGroup = storedMessages.slice(index, end);
    if (!requestGroupHasCancelledMessage(requestGroup)) {
      for (const message of requestGroup) {
        appendStoredMessageForPersistence(message, persistable);
      }
    }
    index = end;
  }

  return persistable;
}

function appendStoredMessageForPersistence(
  message: MessageRow,
  persistable: PersistableRequestMessage[],
): void {
  if (message.cancelled) return;
  if (message.role === "tool") return;

  const attachmentIds = sanitizeAttachmentIds(
    parseAttachmentIds(message.attachment_ids),
  );
  const hasVisibleContent = message.content.length > 0 ||
    (message.display_content?.length ?? 0) > 0 ||
    attachmentIds !== undefined;
  if (!hasVisibleContent) return;

  persistable.push({
    role: message.role,
    content: message.content,
    displayContent: message.display_content ?? undefined,
    attachmentIds,
    clientTurnId: message.client_turn_id ?? undefined,
    senderType: getPersistedSenderType(message.role),
  });
}

function getPersistedSenderType(
  role: PersistableRequestMessage["role"],
): PersistableRequestMessage["senderType"] {
  if (role === "assistant") return "llm";
  return role;
}

function sanitizeAttachmentIds(
  attachmentIds?: string[],
): string[] | undefined {
  if (!attachmentIds?.length) return undefined;
  return [...attachmentIds];
}

function findTranscriptOverlap(
  storedMessages: PersistableRequestMessage[],
  requestMessages: PersistableRequestMessage[],
): number {
  const maxOverlap = Math.min(storedMessages.length, requestMessages.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    let matched = true;
    for (let i = 0; i < overlap; i++) {
      if (
        !persistableMessagesEqual(
          storedMessages[storedMessages.length - overlap + i],
          requestMessages[i],
        )
      ) {
        matched = false;
        break;
      }
    }
    if (matched) return overlap;
  }
  return 0;
}

function persistableMessagesEqual(
  left: PersistableRequestMessage,
  right: PersistableRequestMessage,
): boolean {
  if (left.role !== right.role) return false;

  if (left.clientTurnId && right.clientTurnId) {
    return left.clientTurnId === right.clientTurnId;
  }

  return left.content === right.content &&
    left.displayContent === right.displayContent &&
    attachmentIdListsEqual(left.attachmentIds, right.attachmentIds);
}

function attachmentIdListsEqual(
  left?: string[],
  right?: string[],
): boolean {
  const leftPaths = left ?? [];
  const rightPaths = right ?? [];
  if (leftPaths.length !== rightPaths.length) return false;
  for (let i = 0; i < leftPaths.length; i++) {
    if (leftPaths[i] !== rightPaths[i]) return false;
  }
  return true;
}

async function createReplayMessage(
  options: {
    role: ReplayMessage["role"];
    content: string;
    attachmentIds?: string[];
    attachmentMaterializationOptions?:
      ConversationAttachmentMaterializationOptions;
    toolCalls?: ProviderToolCall[];
    toolName?: string;
    toolCallId?: string;
  },
): Promise<ReplayMessage> {
  const replayMessage: ReplayMessage = {
    role: options.role,
    content: options.content,
  };
  const attachments = await resolveAttachments(
    options.attachmentIds,
    options.attachmentMaterializationOptions,
  );
  if (attachments.length > 0) {
    replayMessage.attachments = attachments;
  }
  if (options.toolCalls?.length) {
    replayMessage.toolCalls = options.toolCalls;
  }
  if (options.toolName) {
    replayMessage.toolName = options.toolName;
  }
  if (options.toolCallId) {
    replayMessage.toolCallId = options.toolCallId;
  }
  return replayMessage;
}

function parseAttachmentIds(attachmentIdsJson: string | null): string[] {
  return parseStoredStringArray(attachmentIdsJson) ?? [];
}

function parseToolCalls(
  toolCallsJson: string | null,
): ProviderToolCall[] | undefined {
  if (!toolCallsJson) return undefined;
  try {
    const parsed = JSON.parse(toolCallsJson);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((value): value is ProviderToolCall =>
      isObjectValue(value) &&
      isObjectValue(value.function) &&
      typeof value.function.name === "string"
    );
  } catch (error) {
    log.warn("Failed to parse stored tool calls", error);
    return undefined;
  }
}

export async function resolveAttachments(
  attachmentIds?: string[],
  options?: ConversationAttachmentMaterializationOptions,
): Promise<ConversationAttachmentPayload[]> {
  if (!attachmentIds?.length) return [];
  return await materializeConversationAttachments(attachmentIds, options);
}

async function injectGlobalReplayMessages(
  messages: ReplayMessage[],
  budget: number,
  currentUserRequest: string,
  includePersistentMemory: boolean,
): Promise<ReplayMessage[]> {
  const replayMessages = [...messages];
  const injected: ReplayMessage[] = [];
  // Do NOT gate on isAutoMemoryEnabled() — user HLVM.md must inject even when
  // auto-memory is off. loadMemoryPrompt handles auto-memory gating internally.
  if (!includePersistentMemory) {
    return replayMessages;
  }
  try {
    const memoryMessage = await loadMemorySystemMessage();
    if (memoryMessage) {
      injected.push(memoryMessage);
    }
  } catch {
    log.debug("Failed to load memory context for chat mode");
  }
  return injected.length > 0
    ? [...injected, ...replayMessages]
    : replayMessages;
}

function toProviderReplayMessages(
  replayMessages: ReplayMessage[],
): ProviderMessage[] {
  const providerMessages: ProviderMessage[] = [];
  for (const message of replayMessages) {
    if (message.role === "tool") {
      providerMessages.push({
        role: "assistant",
        content: formatHistoricalToolReplay(message),
      });
      continue;
    }

    if (
      message.role === "assistant" &&
      !message.content &&
      !message.attachments?.length
    ) {
      continue;
    }

    const providerMessage: ProviderMessage = {
      role: message.role,
      content: message.content,
    };
    if (message.attachments?.length) {
      providerMessage.attachments = message.attachments.map((attachment) => ({
        ...attachment,
      }));
    }
    providerMessages.push(providerMessage);
  }
  return providerMessages.filter(isReplayableProviderMessage);
}

function normalizeReplayMessagesForAgent(
  replayMessages: ReplayMessage[],
): AgentMessage[] {
  const history: AgentMessage[] = [];
  let syntheticToolCallCounter = 0;

  for (const message of replayMessages) {
    if (message.role !== "tool") {
      if (
        message.role === "assistant" &&
        !message.content &&
        !message.attachments?.length &&
        !(message.toolCalls?.length)
      ) {
        continue;
      }
      history.push({ ...message });
      continue;
    }

    if (message.toolCallId) {
      history.push({ ...message });
      continue;
    }

    if (!message.toolName) {
      history.push({
        role: "assistant",
        content: formatHistoricalToolReplay(message),
      });
      continue;
    }

    const toolCallId = `historical-tool-${++syntheticToolCallCounter}`;
    history.push({
      role: "assistant",
      content: "",
      toolCalls: [{
        id: toolCallId,
        function: {
          name: message.toolName,
          arguments: HISTORICAL_TOOL_ARG,
        },
      }],
    });
    history.push({
      ...message,
      toolCallId,
    });
  }

  return history;
}

function formatHistoricalToolReplay(message: ReplayMessage): string {
  const label = message.toolName?.trim()
    ? `Prior tool result (${message.toolName})`
    : "Prior tool result";
  return `${label}:\n${message.content}`;
}

function isReplayableReplayMessage(message: ReplayMessage): boolean {
  return message.content.length > 0 ||
    (message.attachments?.length ?? 0) > 0 ||
    (message.toolCalls?.length ?? 0) > 0 ||
    message.role === "tool";
}

function isReplayableAgentMessage(message: AgentMessage): boolean {
  return message.content.length > 0 ||
    (message.attachments?.length ?? 0) > 0 ||
    (message.toolCalls?.length ?? 0) > 0 ||
    message.role === "tool";
}

function isReplayableProviderMessage(message: ProviderMessage): boolean {
  return message.content.length > 0 || (message.attachments?.length ?? 0) > 0;
}
