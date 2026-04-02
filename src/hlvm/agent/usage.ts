/**
 * Agent Usage - Token accounting for LLM calls
 *
 * Tracks prompt/completion token usage per run.
 * Uses provider-reported usage if available, otherwise falls back
 * to SSOT estimation (adaptive chars/token).
 */

import {
  estimateTokensFromMessages,
  estimateTokensFromText,
} from "../../common/token-utils.ts";
export {
  getMessageCharCount,
  observeTokenUsage,
} from "../../common/token-utils.ts";
import type { Message } from "./context.ts";

type TokenUsageSource = "provider" | "estimated";

type UsageCostSource = "estimated" | "unavailable";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  source: TokenUsageSource;
}

export interface UsageSnapshot {
  calls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  last?: TokenUsage;
  source: TokenUsageSource;
  totalCostUsd?: number;
  costSource: UsageCostSource;
}

interface ModelPrice {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

function resolveModelPrice(modelId?: string): ModelPrice | undefined {
  const normalized = modelId?.toLowerCase().trim();
  if (!normalized) return undefined;

  if (normalized.includes("claude-haiku-4-5")) {
    return { inputUsdPerMillion: 1, outputUsdPerMillion: 5 };
  }
  if (normalized.includes("claude-haiku")) {
    return { inputUsdPerMillion: 0.8, outputUsdPerMillion: 4 };
  }
  if (
    normalized.includes("claude-opus-4-5") ||
    normalized.includes("claude-opus-4-6")
  ) {
    return { inputUsdPerMillion: 5, outputUsdPerMillion: 25 };
  }
  if (normalized.includes("claude-opus")) {
    return { inputUsdPerMillion: 15, outputUsdPerMillion: 75 };
  }
  if (normalized.includes("claude-sonnet")) {
    return { inputUsdPerMillion: 3, outputUsdPerMillion: 15 };
  }

  if (normalized.includes("gemini-2.5-pro")) {
    return { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 };
  }
  if (normalized.includes("gemini-2.5-flash-lite")) {
    return { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4 };
  }
  if (
    normalized.includes("gemini-2.5-flash") ||
    normalized.includes("gemini-2.0-flash")
  ) {
    return { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 };
  }

  if (normalized.includes("o4-mini")) {
    return { inputUsdPerMillion: 1.1, outputUsdPerMillion: 4.4 };
  }
  if (normalized.includes("o3")) {
    return { inputUsdPerMillion: 2, outputUsdPerMillion: 8 };
  }
  if (normalized.includes("gpt-5-mini")) {
    return { inputUsdPerMillion: 0.25, outputUsdPerMillion: 2 };
  }
  if (normalized.includes("gpt-5")) {
    return { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 };
  }

  return undefined;
}

export function estimateUsageCostUsd(
  modelId: string | undefined,
  usage: Pick<TokenUsage, "promptTokens" | "completionTokens">,
): number | undefined {
  const price = resolveModelPrice(modelId);
  if (!price) return undefined;
  return (
    (usage.promptTokens / 1_000_000) * price.inputUsdPerMillion +
    (usage.completionTokens / 1_000_000) * price.outputUsdPerMillion
  );
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

  snapshot(modelId?: string): UsageSnapshot {
    const totalCostUsd = estimateUsageCostUsd(modelId, {
      promptTokens: this.totalPrompt,
      completionTokens: this.totalCompletion,
    });
    return {
      calls: this.calls,
      totalPromptTokens: this.totalPrompt,
      totalCompletionTokens: this.totalCompletion,
      totalTokens: this.totalPrompt + this.totalCompletion,
      last: this.lastUsage,
      source: this.source,
      totalCostUsd,
      costSource: totalCostUsd === undefined ? "unavailable" : "estimated",
    };
  }
}

/**
 * Convert provider-reported usage (inputTokens/outputTokens) to agent TokenUsage.
 * SSOT for the provider→agent usage translation.
 */
export function toTokenUsage(
  usage: { inputTokens: number; outputTokens: number },
): TokenUsage {
  return {
    promptTokens: usage.inputTokens,
    completionTokens: usage.outputTokens,
    totalTokens: usage.inputTokens + usage.outputTokens,
    source: "provider",
  };
}

/**
 * Estimate token usage for an LLM call.
 */
export function estimateUsage(
  promptMessages: Message[],
  completion: string,
  modelKey?: string,
): TokenUsage {
  const promptTokens = estimateTokensFromMessages(promptMessages, modelKey);
  const completionTokens = estimateTokensFromText(completion, modelKey);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    source: "estimated",
  };
}
