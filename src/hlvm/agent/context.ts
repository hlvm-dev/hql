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
 * - Simple token estimation (chars / 4)
 * - Automatic context trimming
 * - Message type tracking
 * - SSOT-compliant implementation
 */

import { DEFAULT_CONTEXT_CONFIG } from "./constants.ts";
import { truncate, truncateMiddle } from "../../common/utils.ts";
// ============================================================
// Types
// ============================================================

/** Role for chat messages (locally defined for SDK decoupling) */
export type MessageRole = "system" | "user" | "assistant" | "tool";

/** Single message in conversation */
export interface Message {
  role: MessageRole;
  content: string;
  timestamp?: number;
  /**
   * Internal marker for session persistence.
   * Messages loaded from a session transcript should set this to true.
   */
  fromSession?: boolean;
  /** Tool calls made by assistant (for native tool calling conversation flow) */
  toolCalls?: Array<{ id?: string; function: { name: string; arguments: unknown } }>;
  /** Name of the tool that produced this result (for role: "tool") */
  toolName?: string;
  /** ID of the tool call this result responds to (correlates with toolCalls[].id) */
  toolCallId?: string;
}

export function isSummaryMessage(message: Message): boolean {
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
        try { argsLen = JSON.stringify(tc.function.arguments).length; } catch { /* circular ref — skip */ }
      }
    }
    chars += nameLen + argsLen + 20; // overhead for id, structure
  }
  return chars;
}

/** Context manager configuration */
export interface ContextConfig {
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

    // Estimate chars for toolCalls metadata (if present)
    const toolCallChars = estimateToolCallChars(messageWithTimestamp);

    if (this.config.overflowStrategy === "fail") {
      const projectedTokens = Math.ceil(
        (this.totalChars + messageWithTimestamp.content.length + toolCallChars) / 4,
      );
      if (projectedTokens > this.config.maxTokens) {
        throw new ContextOverflowError(
          this.config.maxTokens,
          projectedTokens,
        );
      }
    }

    this.messages.push(messageWithTimestamp);
    this.totalChars += messageWithTimestamp.content.length + toolCallChars;
    this.incrementRoleCount(messageWithTimestamp.role);

    // Proactive compaction at threshold (before overflow)
    if (this.config.overflowStrategy === "summarize" && this.config.llmSummarize) {
      const threshold = this.config.maxTokens * this.config.compactionThreshold;
      if (this.estimateTokens() > threshold) {
        this.pendingCompaction = true;
      }
    }

    // Handle overflow if needed
    this.trimIfNeeded();
    // If trimming resolved the overflow, clear pending compaction flag
    if (this.pendingCompaction && !this.needsTrimming()) {
      this.pendingCompaction = false;
    }
  }

  /**
   * Run pending LLM-powered compaction if needed.
   * Must be called from async context (e.g., before LLM call).
   */
  async compactIfNeeded(): Promise<void> {
    if (!this.pendingCompaction || !this.config.llmSummarize) return;
    this.pendingCompaction = false;

    const { system, nonSystem } = this.splitBySystem();

    const keepRecent = Math.max(
      this.config.minMessages,
      this.config.summaryKeepRecent,
    );

    if (nonSystem.length <= keepRecent) return;

    const splitIndex = Math.max(0, nonSystem.length - keepRecent);
    const toSummarize = nonSystem.slice(0, splitIndex);
    const recentMessages = nonSystem.slice(splitIndex);

    try {
      const summary = await this.config.llmSummarize(toSummarize);
      const summaryMessage: Message = {
        role: "assistant",
        content: `Summary of earlier context:\n${summary}`,
        timestamp: Date.now(),
      };

      this.setMessages(
        this.config.preserveSystem
          ? [...system, summaryMessage, ...recentMessages]
          : [summaryMessage, ...recentMessages],
      );
    } catch {
      // LLM summarization failed — fall back to crude summary on next overflow
    }
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
   * Get all messages — callers should not mutate the returned array.
   * Fix 21: Returns internal array directly to avoid GC pressure.
   * Use getMessagesCopy() if you need to mutate.
   *
   * @returns Message array (do not mutate)
   */
  getMessages(): Message[] {
    return this.messages;
  }

  /**
   * Get a mutable copy of all messages
   *
   * @returns Shallow copy of message array
   */
  getMessagesCopy(): Message[] {
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
    return Math.ceil(this.totalChars / 4);
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

    // O(n) trim: compute total tokens, subtract from front until under budget
    let systemChars = 0;
    if (this.config.preserveSystem) {
      for (const m of systemMessages) {
        systemChars += m.content.length + estimateToolCallChars(m);
      }
    }
    const systemTokens = Math.ceil(systemChars / 4);
    let nonSystemChars = 0;
    for (const m of nonSystemMessages) {
      nonSystemChars += m.content.length + estimateToolCallChars(m);
    }
    let nonSystemTokens = Math.ceil(nonSystemChars / 4);
    const maxTrim = nonSystemMessages.length - this.config.minMessages;
    let startIdx = 0;

    while (startIdx < maxTrim && (systemTokens + nonSystemTokens) > this.config.maxTokens) {
      const msg = nonSystemMessages[startIdx];
      nonSystemTokens -= Math.ceil((msg.content.length + estimateToolCallChars(msg)) / 4);
      startIdx++;
    }

    if (startIdx > 0) {
      const trimmedMessages = nonSystemMessages.slice(startIdx);
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

    const splitIndex = Math.max(0, nonSystem.length - keepRecent);
    const toSummarize = nonSystem.slice(0, splitIndex);
    const recentMessages = nonSystem.slice(splitIndex);

    const summary = this.buildSummary(toSummarize);
    const summaryMessage: Message = {
      role: "assistant",
      content: summary,
      timestamp: Date.now(),
    };

    this.setMessages(
      this.config.preserveSystem
        ? [...system, summaryMessage, ...recentMessages]
        : [summaryMessage, ...recentMessages],
    );
  }

  private buildSummary(messages: Message[]): string {
    const lines: string[] = [];
    for (const msg of messages) {
      const normalized = msg.content.replace(/\s+/g, " ").trim();
      const snippet = truncate(normalized, 200);
      lines.push(`- ${msg.role}: ${snippet}`);
    }

    let summary = `Summary of earlier context:\n${lines.join("\n")}`;
    if (summary.length > this.config.summaryMaxChars) {
      summary = summary.slice(0, this.config.summaryMaxChars) + "...";
    }
    return summary;
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
    for (const m of newMessages) {
      this.incrementRoleCount(m.role);
      this.totalChars += m.content.length + estimateToolCallChars(m);
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

    if (this.config.overflowStrategy === "trim" || this.config.overflowStrategy === "summarize") {
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
