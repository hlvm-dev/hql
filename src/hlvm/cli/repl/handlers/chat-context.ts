/**
 * Shared chat/agent transcript assembly.
 *
 * SSOT for:
 * - deciding when request messages override stored session history
 * - normalizing stored/request messages into replayable context
 * - preserving images across chat and agent replay
 * - injecting memory + model-aware trimming for plain chat
 * - reconstructing prior tool observations for HTTP agent follow-up turns
 */

import { isObjectValue } from "../../../../common/utils.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import { config } from "../../../api/config.ts";
import { log } from "../../../api/log.ts";
import {
  ContextManager,
  takeLastMessageGroups,
  type Message as AgentMessage,
} from "../../../agent/context.ts";
import {
  resolveContextBudget,
  type ResolvedBudget,
} from "../../../agent/context-resolver.ts";
import { loadMemoryContext } from "../../../memory/mod.ts";
import type {
  Message as ProviderMessage,
  ModelInfo,
  ProviderToolCall,
} from "../../../providers/types.ts";
import type { MessageRow } from "../../../store/types.ts";
import { detectMimeType } from "../attachment.ts";
import type { ChatRequest } from "./chat-session.ts";

export type ReplayMessage = AgentMessage;

interface BuildReplayMessagesOptions {
  requestMessages: ChatRequest["messages"];
  storedMessages: MessageRow[];
  assistantMessageId?: number;
}

interface BuildChatProviderMessagesOptions extends BuildReplayMessagesOptions {
  modelInfo?: ModelInfo | null;
  modelKey?: string;
}

interface BuildAgentHistoryOptions extends BuildReplayMessagesOptions {
  maxGroups: number;
  modelKey?: string;
}

export interface BuildChatProviderMessagesResult {
  messages: ProviderMessage[];
  resolvedContextBudget: ResolvedBudget;
}

export interface PersistableRequestMessage {
  role: "system" | "user" | "assistant";
  content: string;
  imagePaths?: string[];
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
    return await normalizeRequestMessages(options.requestMessages);
  }
  return await normalizeStoredMessages(
    options.storedMessages,
    options.assistantMessageId,
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
  const currentMessage = options.requestMessages[options.requestMessages.length - 1];
  if (!currentMessage || currentMessage.role !== "user") {
    return [];
  }

  if (!shouldHonorRequestMessages(options.requestMessages)) {
    return [normalizeCurrentUserMessage(currentMessage, options.fallbackClientTurnId)];
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
  const replayMessages = await buildReplayMessages(options);
  const resolvedContextBudget = resolveChatContextBudget(
    options.modelInfo,
    options.modelKey,
  );
  const replayWithMemory = await injectMemoryReplayMessage(
    replayMessages,
    resolvedContextBudget.budget,
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
  const replayMessages = await buildReplayMessages(options);
  const normalized = normalizeReplayMessagesForAgent(replayMessages);
  const filtered = normalized.filter(isReplayableAgentMessage);
  return takeLastMessageGroups(filtered, options.maxGroups, options.modelKey);
}

export function resolveChatContextBudget(
  modelInfo?: ModelInfo | null,
  _modelKey?: string,
): ResolvedBudget {
  const rawContextWindow = isObjectValue(config.snapshot)
    ? config.snapshot.contextWindow
    : undefined;
  const userOverride = typeof rawContextWindow === "number" &&
      Number.isInteger(rawContextWindow) && rawContextWindow > 0
    ? rawContextWindow
    : undefined;
  return resolveContextBudget({
    modelInfo: modelInfo ?? undefined,
    userOverride,
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
): Promise<ReplayMessage[]> {
  const replayMessages: ReplayMessage[] = [];
  for (const message of messages) {
    const replayMessage = await createReplayMessage({
      role: message.role,
      content: message.content,
      imagePaths: message.image_paths,
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
      imagePaths: parseImagePaths(message.image_paths),
      toolCalls: parseToolCalls(message.tool_calls),
      toolName: message.tool_name ?? undefined,
      toolCallId: message.tool_call_id ?? undefined,
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

    const group = storedMessages.slice(index, end).filter((message) =>
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
  if (message.image_paths) return true;
  return message.content.length > 0;
}

function normalizeCurrentUserMessage(
  message: ChatRequest["messages"][number],
  fallbackClientTurnId?: string,
): PersistableRequestMessage {
  return {
    role: "user",
    content: message.content,
    imagePaths: sanitizeImagePaths(message.image_paths),
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

    const imagePaths = sanitizeImagePaths(message.image_paths);
    if (message.content.length === 0 && imagePaths === undefined) {
      continue;
    }

    persistable.push({
      role: message.role,
      content: message.content,
      imagePaths,
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

  for (const message of storedMessages) {
    if (message.cancelled) continue;
    if (message.role === "tool") continue;

    const imagePaths = sanitizeImagePaths(parseImagePaths(message.image_paths));
    const hasVisibleContent = message.content.length > 0 || imagePaths !== undefined;
    if (!hasVisibleContent) continue;

    persistable.push({
      role: message.role,
      content: message.content,
      imagePaths,
      clientTurnId: message.client_turn_id ?? undefined,
      senderType: getPersistedSenderType(message.role),
    });
  }

  return persistable;
}

function getPersistedSenderType(
  role: PersistableRequestMessage["role"],
): PersistableRequestMessage["senderType"] {
  if (role === "assistant") return "llm";
  return role;
}

function sanitizeImagePaths(
  imagePaths?: string[],
): string[] | undefined {
  if (!imagePaths?.length) return undefined;
  return [...imagePaths];
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
    imagePathListsEqual(left.imagePaths, right.imagePaths);
}

function imagePathListsEqual(
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
    imagePaths?: string[];
    toolCalls?: ProviderToolCall[];
    toolName?: string;
    toolCallId?: string;
  },
): Promise<ReplayMessage> {
  const replayMessage: ReplayMessage = {
    role: options.role,
    content: options.content,
  };
  const images = await resolveImages(options.imagePaths);
  if (images.length > 0) {
    replayMessage.images = images;
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

function parseImagePaths(imagePathsJson: string | null): string[] {
  if (!imagePathsJson) return [];
  try {
    const parsed = JSON.parse(imagePathsJson);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch (error) {
    log.warn("Failed to parse stored image paths", error);
    return [];
  }
}

function parseToolCalls(toolCallsJson: string | null): ProviderToolCall[] | undefined {
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
  } catch (error) {
    log.warn(`Failed to read image: ${filePath}`, error);
    return null;
  }
}

async function resolveImages(
  imagePaths?: string[],
): Promise<Array<{ data: string; mimeType: string }>> {
  if (!imagePaths?.length) return [];
  const images: Array<{ data: string; mimeType: string }> = [];
  for (const imagePath of imagePaths) {
    const data = await readImageAsBase64(imagePath);
    if (!data) continue;
    images.push({
      data,
      mimeType: detectMimeType(imagePath),
    });
  }
  return images;
}

async function injectMemoryReplayMessage(
  messages: ReplayMessage[],
  budget: number,
): Promise<ReplayMessage[]> {
  const replayMessages = [...messages];
  try {
    const memoryContext = await loadMemoryContext(budget);
    if (memoryContext) {
      replayMessages.unshift({
        role: "system",
        content: `# Your Memory\n${memoryContext}`,
      });
    }
  } catch {
    log.debug("Failed to load memory context for chat mode");
  }
  return replayMessages;
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
      !message.images?.length
    ) {
      continue;
    }

    const providerMessage: ProviderMessage = {
      role: message.role,
      content: message.content,
    };
    if (message.images?.length) {
      providerMessage.images = message.images.map((image) => image.data);
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
        !message.images?.length &&
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
    (message.images?.length ?? 0) > 0 ||
    (message.toolCalls?.length ?? 0) > 0 ||
    message.role === "tool";
}

function isReplayableAgentMessage(message: AgentMessage): boolean {
  return message.content.length > 0 ||
    (message.images?.length ?? 0) > 0 ||
    (message.toolCalls?.length ?? 0) > 0 ||
    message.role === "tool";
}

function isReplayableProviderMessage(message: ProviderMessage): boolean {
  return message.content.length > 0 || (message.images?.length ?? 0) > 0;
}
