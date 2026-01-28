/**
 * Context Manager - Message history and token budget management
 *
 * Manages conversation context for AI agent:
 * - Message array (system, user, assistant, tool)
 * - Token budget enforcement (12K default)
 * - Sliding window for context overflow
 * - Result truncation for large outputs
 *
 * Features:
 * - Simple token estimation (chars / 4)
 * - Automatic context trimming
 * - Message type tracking
 * - SSOT-compliant implementation
 */

// ============================================================
// Types
// ============================================================

/** Message roles in conversation */
export type MessageRole = "system" | "user" | "assistant" | "tool";

/** Single message in conversation */
export interface Message {
  role: MessageRole;
  content: string;
  timestamp?: number;
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
  overflowStrategy: "trim" | "fail";
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
export interface ContextStats {
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

  constructor(config?: Partial<ContextConfig>) {
    this.config = {
      maxTokens: config?.maxTokens ?? 12000,
      maxResultLength: config?.maxResultLength ?? 5000,
      preserveSystem: config?.preserveSystem ?? true,
      minMessages: config?.minMessages ?? 2,
      overflowStrategy: config?.overflowStrategy ?? "trim",
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

    if (this.config.overflowStrategy === "fail") {
      const projectedTokens = this.estimateTokensForMessages([
        ...this.messages,
        messageWithTimestamp,
      ]);
      if (projectedTokens > this.config.maxTokens) {
        throw new ContextOverflowError(
          this.config.maxTokens,
          projectedTokens,
        );
      }
    }

    this.messages.push(messageWithTimestamp);

    // Trim if needed
    this.trimIfNeeded();
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
   * Get all messages
   *
   * @returns Copy of message array
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
      systemMessages: this.messages.filter((m) => m.role === "system").length,
      userMessages: this.messages.filter((m) => m.role === "user").length,
      assistantMessages: this.messages.filter((m) => m.role === "assistant")
        .length,
      toolMessages: this.messages.filter((m) => m.role === "tool").length,
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
   * Estimate token count
   *
   * Simple estimation: characters / 4
   * (GPT tokens are roughly 4 chars on average)
   *
   * @returns Estimated token count
   */
  estimateTokens(): number {
    const totalChars = this.messages.reduce(
      (sum, msg) => sum + msg.content.length,
      0,
    );
    return Math.ceil(totalChars / 4);
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
    if (result.length <= this.config.maxResultLength) {
      return result;
    }

    const truncated = result.substring(0, this.config.maxResultLength);
    const notice =
      `\n\n[Result truncated: ${result.length} chars → ${this.config.maxResultLength} chars]`;

    return truncated + notice;
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

    // Separate system messages from others
    const systemMessages = this.messages.filter((m) => m.role === "system");
    const nonSystemMessages = this.messages.filter((m) => m.role !== "system");

    // Can't trim if too few messages
    if (nonSystemMessages.length <= this.config.minMessages) {
      return;
    }

    // Remove oldest non-system messages until under budget
    let trimmedMessages = [...nonSystemMessages];

    while (
      this.estimateTokensForMessages(
          this.config.preserveSystem
            ? [...systemMessages, ...trimmedMessages]
            : trimmedMessages,
        ) > this.config.maxTokens &&
      trimmedMessages.length > this.config.minMessages
    ) {
      // Remove oldest message
      trimmedMessages = trimmedMessages.slice(1);
    }

    // Reconstruct message array
    this.messages = this.config.preserveSystem
      ? [...systemMessages, ...trimmedMessages]
      : trimmedMessages;
  }

  /**
   * Estimate tokens for specific messages
   *
   * @param messages Messages to estimate
   * @returns Estimated token count
   */
  private estimateTokensForMessages(messages: Message[]): number {
    const totalChars = messages.reduce(
      (sum, msg) => sum + msg.content.length,
      0,
    );
    return Math.ceil(totalChars / 4);
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

    if (this.config.overflowStrategy === "trim") {
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
