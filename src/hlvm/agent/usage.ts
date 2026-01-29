/**
 * Agent Usage - Token accounting for LLM calls
 *
 * Tracks prompt/completion token usage per run.
 * Uses provider-reported usage if available, otherwise falls back
 * to SSOT estimation (chars/4).
 */

import { estimateTokensFromMessages, estimateTokensFromText } from "../../common/token-utils.ts";
import type { Message } from "./context.ts";

type TokenUsageSource = "provider" | "estimated";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  source: TokenUsageSource;
}

interface UsageSnapshot {
  calls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  last?: TokenUsage;
  source: TokenUsageSource;
}

export class UsageTracker {
  private calls = 0;
  private totalPrompt = 0;
  private totalCompletion = 0;
  private lastUsage: TokenUsage | undefined;
  private source: TokenUsageSource = "estimated";

  record(usage: TokenUsage): void {
    this.calls += 1;
    this.totalPrompt += usage.promptTokens;
    this.totalCompletion += usage.completionTokens;
    this.lastUsage = usage;
    this.source = usage.source;
  }

  snapshot(): UsageSnapshot {
    return {
      calls: this.calls,
      totalPromptTokens: this.totalPrompt,
      totalCompletionTokens: this.totalCompletion,
      totalTokens: this.totalPrompt + this.totalCompletion,
      last: this.lastUsage,
      source: this.source,
    };
  }
}

/**
 * Estimate token usage for an LLM call.
 */
export function estimateUsage(
  promptMessages: Message[],
  completion: string,
): TokenUsage {
  const promptTokens = estimateTokensFromMessages(promptMessages);
  const completionTokens = estimateTokensFromText(completion);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    source: "estimated",
  };
}
