import { extractModelSuffix, extractProviderName } from "./constants.ts";
import type { ThinkingState } from "./engine.ts";

export interface ThinkingProfileInput {
  contextBudget?: number;
  thinkingCapable?: boolean;
  thinkingState?: ThinkingState;
  model?: string;
  modelId?: string;
  providerName?: string;
}

export interface ThinkingProfile {
  anthropicBudgetTokens: number;
  openaiReasoningEffort: "low" | "medium" | "high";
  googleThinkingLevel: "low" | "medium" | "high";
}

function capThinkingBudget(
  input: ThinkingProfileInput,
  targetBudget: number,
): number {
  const referenceBudget = input.thinkingState?.remainingContextBudget ??
    input.contextBudget;
  if (!referenceBudget || referenceBudget <= 0) {
    return targetBudget;
  }
  const capped = Math.floor(referenceBudget * 0.25);
  return Math.max(1024, Math.min(targetBudget, capped));
}

export function supportsNativeThinking(input: ThinkingProfileInput): boolean {
  if (input.thinkingCapable) return true;

  const providerName = (input.providerName ?? extractProviderName(input.model))
    .toLowerCase();
  const modelId = (input.modelId ?? extractModelSuffix(input.model))
    .toLowerCase();

  switch (providerName) {
    case "anthropic":
    case "claude-code":
      return modelId.startsWith("claude-");
    case "openai":
      return /^o[134]/.test(modelId) || modelId.startsWith("gpt-5");
    case "google":
      return modelId.startsWith("gemini-2.5");
    default:
      return false;
  }
}

export function resolveThinkingProfile(
  input: ThinkingProfileInput,
): ThinkingProfile {
  const iteration = input.thinkingState?.iteration ?? 0;
  const recentToolCalls = input.thinkingState?.recentToolCalls ?? 0;
  const consecutiveFailures = input.thinkingState?.consecutiveFailures ?? 0;
  const phase = input.thinkingState?.phase ?? "";

  let complexityScore = 0;
  if (iteration >= 3) complexityScore += 1;
  if (iteration >= 8) complexityScore += 1;
  if (recentToolCalls >= 2) complexityScore += 1;
  if (consecutiveFailures > 0) complexityScore += 1;
  if (phase === "editing" || phase === "verifying") complexityScore += 1;

  if (complexityScore >= 4) {
    return {
      anthropicBudgetTokens: capThinkingBudget(input, 32000),
      openaiReasoningEffort: "high",
      googleThinkingLevel: "high",
    };
  }
  if (complexityScore >= 2) {
    return {
      anthropicBudgetTokens: capThinkingBudget(input, 16000),
      openaiReasoningEffort: "medium",
      googleThinkingLevel: "medium",
    };
  }
  return {
    anthropicBudgetTokens: capThinkingBudget(input, 5000),
    openaiReasoningEffort: "low",
    googleThinkingLevel: "low",
  };
}
