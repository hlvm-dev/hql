/**
 * Context Manager - Message history and token budget management
 *
 * Manages conversation context for AI agent:
 * - Message array (system, user, assistant, tool)
 * - Token budget enforcement (32K default)
 * - Sliding window for context overflow
 * - Result truncation for large outputs
 *
 * Features:
 * - Shared token estimation via common/token-utils SSOT
 * - Automatic context trimming
 * - Message type tracking
 * - SSOT-compliant implementation
 */

import { DEFAULT_CONTEXT_CONFIG } from "./constants.ts";
import { estimateTokensFromCharCount } from "../../common/token-utils.ts";
import { truncate, truncateMiddle } from "../../common/utils.ts";
import type { ConversationAttachmentPayload } from "../attachments/types.ts";
import { collectFiles, collectSymbols } from "./compaction-template.ts";
import type { FileRestorationHint } from "./file-state-cache.ts";
// ============================================================
// Types
// ============================================================

/** Role for chat messages (locally defined for SDK decoupling) */
export type MessageRole = "system" | "user" | "assistant" | "tool";

/** Single message in conversation */
export interface Message {
  role: MessageRole;
  content: string;
  /** Assistant/tool API round boundary used for compaction/orphan prevention. */
  roundId?: string;
  timestamp?: number;
  /**
   * Internal marker for session persistence.
   * Messages loaded from a session transcript should set this to true.
   */
  fromSession?: boolean;
  /** Runtime-materialized attachments for provider execution. */
  attachments?: ConversationAttachmentPayload[];
  /** Tool calls made by assistant (for native tool calling conversation flow) */
  toolCalls?: Array<
    { id?: string; function: { name: string; arguments: unknown } }
  >;
  /** Name of the tool that produced this result (for role: "tool") */
  toolName?: string;
  /** ID of the tool call this result responds to (correlates with toolCalls[].id) */
  toolCallId?: string;
  /** SDK-native response messages for lossless reasoning passthrough.
   *  Not persisted; lost on session reload (graceful degradation). */
  _sdkResponseMessages?: unknown[];
}

function isSummaryMessage(message: Message): boolean {
  return message.role === "assistant" &&
    message.content.startsWith("Summary of earlier context:");
}

/** Estimate character overhead from toolCalls metadata on a message (SSOT helper) */
function estimateToolCallChars(message: Message): number {
  if (!message.toolCalls?.length) return 0;
  let chars = 0;
  for (const tc of message.toolCalls) {
    const nameLen = tc.function?.name?.length ?? 0;
    let argsLen = 0;
    if (tc.function?.arguments) {
      if (typeof tc.function.arguments === "string") {
        argsLen = tc.function.arguments.length;
      } else {
        // Cache stringified length to avoid repeated JSON.stringify on same object
        const cached = (tc as Record<string, unknown>)._cachedArgLen;
        if (typeof cached === "number") {
          argsLen = cached;
        } else {
          try {
            argsLen = JSON.stringify(tc.function.arguments).length;
            (tc as Record<string, unknown>)._cachedArgLen = argsLen;
          } catch { /* circular ref — skip */ }
        }
      }
    }
    chars += nameLen + argsLen + 20; // overhead for id, structure
  }
  return chars;
}

function estimateAttachmentChars(message: Message): number {
  if (!message.attachments?.length) return 0;
  let chars = 0;
  for (const att of message.attachments) {
    chars += att.mode === "text" ? att.text.length : att.size;
  }
  return chars;
}

function hasAssistantToolCalls(message: Message): boolean {
  return message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0;
}

function getAssistantToolCallIds(message: Message): Set<string> {
  if (!hasAssistantToolCalls(message)) return new Set();
  return new Set(
    (message.toolCalls ?? [])
      .map((call) => typeof call.id === "string" ? call.id : undefined)
      .filter((id): id is string => !!id),
  );
}

const COMPACTED_TOOL_RESULT_SENTINEL = "[Tool result cleared — compacted]";
const MICROCOMPACTABLE_TOOL_NAMES = new Set([
  "read_file",
  "list_files",
  "search_code",
  "find_symbol",
  "get_structure",
  "web_fetch",
  "fetch_url",
  "search_web",
  "shell_exec",
  "shell_script",
  "write_file",
  "edit_file",
]);

function isMicrocompactableToolMessage(message: Message): boolean {
  if (message.role !== "tool") return false;
  if (message.content.includes(COMPACTED_TOOL_RESULT_SENTINEL)) return false;
  const toolName = message.toolName?.toLowerCase();
  if (!toolName) return false;
  return MICROCOMPACTABLE_TOOL_NAMES.has(toolName) ||
    toolName.startsWith("mcp_");
}

interface MessageGroup {
  messages: Message[];
  messageCount: number;
  estimatedTokens: number;
}

function estimateMessageTokens(
  message: Message,
  modelKey?: string,
): number {
  return estimateTokensFromCharCount(
    message.content.length + estimateToolCallChars(message) +
      estimateAttachmentChars(message),
    modelKey,
  );
}

function buildMessageGroups(
  messages: Message[],
  modelKey?: string,
): MessageGroup[] {
  const groups: MessageGroup[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const groupMessages: Message[] = [message];
    const roundId = message.roundId;

    if (roundId) {
      while (i + 1 < messages.length && messages[i + 1].roundId === roundId) {
        groupMessages.push(messages[i + 1]);
        i++;
      }
    } else if (hasAssistantToolCalls(message)) {
      const toolCallIds = getAssistantToolCallIds(message);
      while (i + 1 < messages.length && messages[i + 1].role === "tool") {
        const next = messages[i + 1];
        const nextToolCallId = next.toolCallId;
        if (
          toolCallIds.size > 0 &&
          typeof nextToolCallId === "string" &&
          !toolCallIds.has(nextToolCallId)
        ) {
          break;
        }
        groupMessages.push(next);
        i++;
      }
    }

    groups.push({
      messages: groupMessages,
      messageCount: groupMessages.length,
      estimatedTokens: groupMessages.reduce(
        (sum, entry) => sum + estimateMessageTokens(entry, modelKey),
        0,
      ),
    });
  }

  return groups;
}

function flattenMessageGroups(groups: MessageGroup[]): Message[] {
  return groups.flatMap((group) => group.messages);
}

function splitRecentMessageGroups(
  messages: Message[],
  keepRecentMessages: number,
  modelKey?: string,
): { toSummarize: Message[]; recentMessages: Message[] } {
  if (messages.length === 0 || keepRecentMessages <= 0) {
    return { toSummarize: [...messages], recentMessages: [] };
  }

  const groups = buildMessageGroups(messages, modelKey);
  if (groups.length === 0) {
    return { toSummarize: [], recentMessages: [] };
  }

  let recentCount = 0;
  let splitGroupIndex = groups.length;
  for (let i = groups.length - 1; i >= 0; i--) {
    if (recentCount >= keepRecentMessages) break;
    recentCount += groups[i].messageCount;
    splitGroupIndex = i;
  }

  return {
    toSummarize: flattenMessageGroups(groups.slice(0, splitGroupIndex)),
    recentMessages: flattenMessageGroups(groups.slice(splitGroupIndex)),
  };
}

export function takeLastMessageGroups(
  messages: Message[],
  maxGroups: number,
  modelKey?: string,
): Message[] {
  if (maxGroups <= 0 || messages.length === 0) return [];
  const groups = buildMessageGroups(messages, modelKey);
  if (groups.length <= maxGroups) return [...messages];
  return flattenMessageGroups(groups.slice(-maxGroups));
}

/** Context manager configuration */
interface ContextConfig {
  /** Maximum tokens allowed in context (default: 12000) */
  maxTokens: number;
  /** Maximum length for tool results before truncation (default: 5000 chars) */
  maxResultLength: number;
  /** Keep system messages when trimming (default: true) */
  preserveSystem: boolean;
  /** Minimum messages to keep (default: 2) */
  minMessages: number;
  /** Overflow strategy when context exceeds maxTokens (default: "trim") */
  overflowStrategy: "trim" | "fail" | "summarize";
  /** Maximum characters for summary message (default: 1200) */
  summaryMaxChars: number;
  /** Messages to preserve at end when summarizing (default: 4) */
  summaryKeepRecent: number;
  /** Optional LLM-powered summarization callback. Falls back to crude snippet summary when not set. */
  llmSummarize?: (messages: Message[]) => Promise<string>;
  /** Fraction of maxTokens at which to trigger proactive compaction (default: 0.8) */
  compactionThreshold: number;
  /** Optional model key for model-scoped token estimation calibration */
  modelKey?: string;
  /** Optional recent full-file restoration hints appended after compaction. */
  buildRestorationHints?: (
    maxContextTokens: number,
  ) => FileRestorationHint[];
}

/** Result of a compactIfNeeded() call */
export interface CompactionResult {
  status: "skipped" | "success" | "failed";
  error?: string;
}

/** Error thrown when context exceeds maxTokens in fail mode */
export class ContextOverflowError extends Error {
  readonly maxTokens: number;
  readonly estimatedTokens: number;

  constructor(maxTokens: number, estimatedTokens: number) {
    super(
      `Context overflow: estimated ${estimatedTokens} tokens exceeds max ${maxTokens}`,
    );
    this.name = "ContextOverflowError";
    this.maxTokens = maxTokens;
    this.estimatedTokens = estimatedTokens;
  }
}

/** Context statistics */
interface ContextStats {
  messageCount: number;
  estimatedTokens: number;
  systemMessages: number;
  userMessages: number;
  assistantMessages: number;
  toolMessages: number;
}

// ============================================================
// Context Manager Class
// ============================================================

/**
 * Context Manager - Manages conversation history and token budget
 *
 * @example
 * ```ts
 * const context = new ContextManager({ maxTokens: 12000 });
 *
 * context.addMessage({ role: "system", content: "You are a helpful assistant." });
 * context.addMessage({ role: "user", content: "Hello!" });
 * context.addMessage({ role: "assistant", content: "Hi! How can I help?" });
 *
 * const messages = context.getMessages();
 * const stats = context.getStats();
 * ```
 */
export class ContextManager {
  private messages: Message[] = [];
  private config: ContextConfig;
  private pendingCompaction = false;
  private compactionRevision = 0;
  private messageRevision = 0;
  /** Running tallies for O(1) getStats() */
  private roleCounts = { system: 0, user: 0, assistant: 0, tool: 0 };
  /** Cached total character count for O(1) estimateTokens() */
  private totalChars = 0;

  constructor(config?: Partial<ContextConfig>) {
    this.config = {
      ...DEFAULT_CONTEXT_CONFIG,
      ...config,
    };
  }

  /** Whether LLM-powered compaction is pending (context nearing limit). */
  get isPendingCompaction(): boolean {
    return this.pendingCompaction;
  }

  getCompactionRevision(): number {
    return this.compactionRevision;
  }

  getMessageRevision(): number {
    return this.messageRevision;
  }

  /**
   * Add message to context
   *
   * Automatically trims context if token budget exceeded.
   *
   * @param message Message to add
   */
  addMessage(message: Message): void {
    // Add timestamp if not present
    const messageWithTimestamp: Message = {
      ...message,
      timestamp: message.timestamp ?? Date.now(),
    };

    // Estimate chars for toolCalls metadata and attachments (if present)
    const extraChars = estimateToolCallChars(messageWithTimestamp) +
      estimateAttachmentChars(messageWithTimestamp);

    if (this.config.overflowStrategy === "fail") {
      const projectedTokens = estimateTokensFromCharCount(
        this.totalChars + messageWithTimestamp.content.length + extraChars,
        this.config.modelKey,
      );
      if (projectedTokens > this.config.maxTokens) {
        throw new ContextOverflowError(
          this.config.maxTokens,
          projectedTokens,
        );
      }
    }

    this.messages.push(messageWithTimestamp);
    this.totalChars += messageWithTimestamp.content.length + extraChars;
    this.incrementRoleCount(messageWithTimestamp.role);
    this.messageRevision++;

    // Proactive compaction at threshold (before overflow)
    if (
      this.config.overflowStrategy === "summarize" && this.config.llmSummarize
    ) {
      const threshold = this.config.maxTokens * this.config.compactionThreshold;
      if (this.estimateTokens() > threshold) {
        this.pendingCompaction = true;
      }
    }

    // Handle overflow if needed
    this.trimIfNeeded();
  }

  /**
   * Run pending LLM-powered compaction if needed.
   * Must be called from async context (e.g., before LLM call).
   */
  async compactIfNeeded(): Promise<CompactionResult> {
    if (!this.pendingCompaction || !this.config.llmSummarize) {
      return { status: "skipped" };
    }
    this.pendingCompaction = false;

    const { system, nonSystem } = this.splitBySystem();

    const keepRecent = Math.max(
      this.config.minMessages,
      this.config.summaryKeepRecent,
    );

    if (nonSystem.length <= keepRecent) return { status: "skipped" };
    const { toSummarize, recentMessages } = splitRecentMessageGroups(
      nonSystem,
      keepRecent,
      this.config.modelKey,
    );
    if (toSummarize.length === 0) return { status: "skipped" };
    const compactedMessages = this.prepareMessagesForCompaction(toSummarize);

    try {
      const summary = await this.config.llmSummarize(compactedMessages);
      const summaryMessage: Message = {
        role: "assistant",
        content: `Summary of earlier context:\n${summary}`,
        timestamp: Date.now(),
      };
      const restorationMessages = this.buildRestorationMessages();

      this.compactionRevision++;
      this.setMessages(
        this.config.preserveSystem
          ? [...system, summaryMessage, ...restorationMessages, ...recentMessages]
          : [summaryMessage, ...restorationMessages, ...recentMessages],
      );
      // Postcondition: guarantee fit even if summary + recent still over budget
      if (this.needsTrimming()) {
        this.trimIfNeeded();
      }
      return { status: "success" };
    } catch (err) {
      // LLM summarization failed — re-arm so next addMessage triggers retry
      this.pendingCompaction = true;
      // Still guarantee fit on failure
      if (this.needsTrimming()) {
        this.trimIfNeeded();
      }
      return { status: "failed", error: String(err) };
    }
  }

  /**
   * Append a runtime directive without triggering trim.
   * Used only for pre-compaction nudges where compaction will run on the next iteration.
   */
  addDirectiveUntrimmed(message: Message): void {
    const messageWithTimestamp: Message = {
      ...message,
      timestamp: message.timestamp ?? Date.now(),
    };
    const extraChars = estimateToolCallChars(messageWithTimestamp) +
      estimateAttachmentChars(messageWithTimestamp);
    this.messages.push(messageWithTimestamp);
    this.totalChars += messageWithTimestamp.content.length + extraChars;
    this.incrementRoleCount(messageWithTimestamp.role);
    this.messageRevision++;
  }

  /**
   * Add multiple messages
   *
   * @param messages Messages to add
   */
  addMessages(messages: Message[]): void {
    for (const message of messages) {
      this.addMessage(message);
    }
  }

  /**
   * Get all messages as a defensive (shallow) copy.
   *
   * @returns Message array copy
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Get messages by role
   *
   * @param role Message role to filter
   * @returns Messages with specified role
   */
  getMessagesByRole(role: MessageRole): Message[] {
    return this.messages.filter((m) => m.role === role);
  }

  /**
   * Get last N messages
   *
   * @param count Number of messages to retrieve
   * @returns Last N messages
   */
  getLastMessages(count: number): Message[] {
    return this.messages.slice(-count);
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.messages = [];
    this.roleCounts = { system: 0, user: 0, assistant: 0, tool: 0 };
    this.totalChars = 0;
    this.messageRevision++;
  }

  /**
   * Get context statistics
   *
   * @returns Statistics about current context
   */
  getStats(): ContextStats {
    return {
      messageCount: this.messages.length,
      estimatedTokens: this.estimateTokens(),
      systemMessages: this.roleCounts.system,
      userMessages: this.roleCounts.user,
      assistantMessages: this.roleCounts.assistant,
      toolMessages: this.roleCounts.tool,
    };
  }

  /** Get the current maxTokens budget */
  getMaxTokens(): number {
    return this.config.maxTokens;
  }

  /** Update the maxTokens budget (e.g., after learning actual context limit) */
  setMaxTokens(maxTokens: number): void {
    this.config.maxTokens = maxTokens;
  }

  /** Request an LLM-powered compaction pass before the next model call. */
  requestCompaction(): void {
    if (
      this.config.overflowStrategy === "summarize" &&
      this.config.llmSummarize
    ) {
      this.pendingCompaction = true;
    }
  }

  /** Force context to fit within current maxTokens budget (e.g., after budget reduction from overflow). */
  trimToFit(): void {
    this.trimIfNeeded();
  }

  /**
   * Check if context needs trimming
   *
   * @returns True if estimated tokens exceed max tokens
   */
  needsTrimming(): boolean {
    return this.estimateTokens() > this.config.maxTokens;
  }

  /**
   * Estimate token count — O(1) using cached character total
   *
   * @returns Estimated token count
   */
  estimateTokens(): number {
    return estimateTokensFromCharCount(this.totalChars, this.config.modelKey);
  }

  /**
   * Truncate tool result if too long
   *
   * Large tool results can blow up context.
   * This truncates results with a notice.
   *
   * @param result Tool result string
   * @returns Truncated result if needed
   */
  truncateResult(result: string): string {
    return truncateMiddle(result, this.config.maxResultLength);
  }

  /**
   * Trim context using sliding window
   *
   * Removes oldest messages (except system) until under budget.
   * Always preserves:
   * - System messages (if preserveSystem=true)
   * - Minimum number of recent messages (minMessages)
   */
  private trimIfNeeded(): void {
    if (!this.needsTrimming()) {
      return;
    }

    if (this.config.overflowStrategy === "summarize") {
      this.summarizeIfNeeded();
      // If still over budget, fall back to trimming
      if (!this.needsTrimming()) {
        return;
      }
    }

    // Separate system/summary messages from others
    const preserveSummary = this.config.overflowStrategy === "summarize";
    const systemMessages: Message[] = [];
    const nonSystemMessages: Message[] = [];
    for (const m of this.messages) {
      if (m.role === "system" || (preserveSummary && isSummaryMessage(m))) {
        systemMessages.push(m);
      } else {
        nonSystemMessages.push(m);
      }
    }

    // Can't trim if too few messages
    if (nonSystemMessages.length <= this.config.minMessages) {
      return;
    }

    const nonSystemGroups = buildMessageGroups(
      nonSystemMessages,
      this.config.modelKey,
    );
    if (nonSystemGroups.length === 0) return;

    // O(n) trim: compute total tokens, subtract from front until under budget
    let systemChars = 0;
    if (this.config.preserveSystem) {
      for (const m of systemMessages) {
        systemChars += m.content.length + estimateToolCallChars(m) +
          estimateAttachmentChars(m);
      }
    }
    const systemTokens = estimateTokensFromCharCount(
      systemChars,
      this.config.modelKey,
    );
    let nonSystemTokens = nonSystemGroups.reduce(
      (sum, group) => sum + group.estimatedTokens,
      0,
    );
    let remainingMessages = nonSystemMessages.length;
    let startGroupIdx = 0;

    while (
      startGroupIdx < nonSystemGroups.length &&
      (systemTokens + nonSystemTokens) > this.config.maxTokens
    ) {
      const nextGroup = nonSystemGroups[startGroupIdx];
      if (
        remainingMessages - nextGroup.messageCount < this.config.minMessages
      ) {
        break;
      }
      nonSystemTokens -= nextGroup.estimatedTokens;
      remainingMessages -= nextGroup.messageCount;
      startGroupIdx++;
    }

    if (startGroupIdx > 0) {
      const trimmedMessages = flattenMessageGroups(
        nonSystemGroups.slice(startGroupIdx),
      );
      this.compactionRevision++;
      this.setMessages(
        this.config.preserveSystem
          ? [...systemMessages, ...trimmedMessages]
          : trimmedMessages,
      );
    }
  }

  /**
   * Summarize older messages to reduce context size
   *
   * Replaces older non-system messages with a single summary message,
   * while keeping the most recent messages intact.
   */
  private summarizeIfNeeded(): void {
    if (!this.needsTrimming()) return;

    const { system, nonSystem } = this.splitBySystem();

    const keepRecent = Math.max(
      this.config.minMessages,
      this.config.summaryKeepRecent,
    );

    if (nonSystem.length <= keepRecent) {
      return;
    }

    const { toSummarize, recentMessages } = splitRecentMessageGroups(
      nonSystem,
      keepRecent,
      this.config.modelKey,
    );
    if (toSummarize.length === 0) {
      return;
    }

    const summary = this.buildSummary(this.prepareMessagesForCompaction(toSummarize));
    const summaryMessage: Message = {
      role: "assistant",
      content: summary,
      timestamp: Date.now(),
    };
    const restorationMessages = this.buildRestorationMessages();

    this.compactionRevision++;
    this.setMessages(
      this.config.preserveSystem
        ? [...system, summaryMessage, ...restorationMessages, ...recentMessages]
        : [summaryMessage, ...restorationMessages, ...recentMessages],
    );
  }

  private buildSummary(messages: Message[]): string {
    const sections: string[] = ["Summary of earlier context:"];

    // User asks (most recent, highest priority)
    const userAsks = messages
      .filter((m) => m.role === "user")
      .slice(-5)
      .map((m) =>
        `- ${truncate(m.content.replace(/\s+/g, " ").trim(), 300)}`
      );
    if (userAsks.length) sections.push("User requests:\n" + userAsks.join("\n"));

    // Files and symbols referenced
    const files = collectFiles(messages);
    const symbols = collectSymbols(messages);
    if (files.length) {
      sections.push("Files: " + files.slice(0, 10).join(", "));
    }
    if (symbols.length) {
      sections.push("Symbols: " + symbols.slice(0, 10).join(", "));
    }

    // Errors
    const errors = messages
      .filter((m) =>
        /\b(error|failed|exception|timeout)\b/i.test(m.content)
      )
      .slice(-3)
      .map((m) =>
        `- ${truncate(m.content.replace(/\s+/g, " ").trim(), 200)}`
      );
    if (errors.length) sections.push("Errors:\n" + errors.join("\n"));

    // Last assistant state
    const lastAssistant = messages
      .filter((m) => m.role === "assistant")
      .slice(-2)
      .map((m) =>
        `- ${truncate(m.content.replace(/\s+/g, " ").trim(), 200)}`
      );
    if (lastAssistant.length) {
      sections.push("Last state:\n" + lastAssistant.join("\n"));
    }

    let summary = sections.join("\n\n");
    if (summary.length > this.config.summaryMaxChars) {
      summary = summary.slice(0, this.config.summaryMaxChars) + "...";
    }
    return summary;
  }

  private prepareMessagesForCompaction(messages: Message[]): Message[] {
    return messages.map((message) => {
      if (!isMicrocompactableToolMessage(message)) return message;
      return {
        ...message,
        content: COMPACTED_TOOL_RESULT_SENTINEL,
      };
    });
  }

  private buildRestorationMessages(): Message[] {
    const hints = this.config.buildRestorationHints?.(this.config.maxTokens) ??
      [];
    return hints.map((hint) => ({
      role: "assistant" as const,
      content:
        `Restored file context: ${hint.path}\n\n${truncateMiddle(hint.content, hint.estimatedTokens * 4)}`,
      timestamp: Date.now(),
    }));
  }

  /** Split messages into system and non-system (DRY helper) */
  private splitBySystem(): { system: Message[]; nonSystem: Message[] } {
    const system: Message[] = [];
    const nonSystem: Message[] = [];
    for (const m of this.messages) {
      if (m.role === "system") {
        system.push(m);
      } else {
        nonSystem.push(m);
      }
    }
    return { system, nonSystem };
  }

  /** Replace messages and recompute role counts + cached char total */
  private setMessages(newMessages: Message[]): void {
    this.messages = newMessages;
    this.roleCounts = { system: 0, user: 0, assistant: 0, tool: 0 };
    this.totalChars = 0;
    this.messageRevision++;
    for (const m of newMessages) {
      this.incrementRoleCount(m.role);
      this.totalChars += m.content.length + estimateToolCallChars(m) +
        estimateAttachmentChars(m);
    }
  }

  /** Increment the role tally */
  private incrementRoleCount(role: MessageRole): void {
    if (role in this.roleCounts) {
      this.roleCounts[role as keyof typeof this.roleCounts]++;
    }
  }

  /**
   * Get configuration
   *
   * @returns Current configuration
   */
  getConfig(): ContextConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   *
   * @param config Partial configuration to update
   */
  updateConfig(config: Partial<ContextConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };

    if (
      this.config.overflowStrategy === "trim" ||
      this.config.overflowStrategy === "summarize"
    ) {
      this.trimIfNeeded();
      return;
    }

    if (this.needsTrimming()) {
      throw new ContextOverflowError(
        this.config.maxTokens,
        this.estimateTokens(),
      );
    }
  }
}
