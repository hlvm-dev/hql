/**
 * Auto Model Selection — `--model auto`
 *
 * When the user passes `--model auto`, HLVM queries all configured providers,
 * scores available models against task signals, picks the best one, and keeps
 * 1-2 fallbacks for hard failures.
 *
 * All scoring is pure (no side effects). Only `resolveAutoModel()` performs I/O.
 */

import { classifyModelTier, isFrontierProvider } from "./constants.ts";
import { classifyForLocalFallback } from "../runtime/local-fallback.ts";
import { ValidationError } from "../../common/error.ts";
import type { ModelInfo } from "../providers/types.ts";
import type { LLMFunction } from "./orchestrator-llm.ts";
import type { LLMResponse } from "./tool-call.ts";
import type { TraceEvent } from "./orchestrator.ts";

// ============================================================
// Types
// ============================================================

/** Signals extracted from the user's turn */
export interface TaskProfile {
  hasImage: boolean;
  promptIsLarge: boolean;
  preferCheap: boolean;
  preferQuality: boolean;
  localOnly: boolean;
  noUpload: boolean;
  needsStructuredOutput: boolean;
  isCodeTask: boolean;
  isReasoningTask: boolean;
  estimatedTokens: number;
}

export type CodingStrength = "weak" | "mid" | "strong";
export type CostTier = "free" | "cheap" | "mid" | "premium";

/** Normalized model capabilities for scoring */
export interface ModelCaps {
  id: string;
  provider: string;
  vision: boolean;
  longContext: boolean;
  structuredOutput: boolean;
  toolCalling: boolean;
  local: boolean;
  costTier: CostTier;
  codingStrength: CodingStrength;
  /** Whether the model has chain-of-thought/thinking capability (o1, o3, deepseek-r1). */
  reasoning: boolean;
  /** Whether the provider has a valid API key (cloud models require this). */
  apiKeyConfigured: boolean;
}

/** Result of auto selection */
export interface AutoDecision {
  model: string;
  fallbacks: string[];
  reason: string;
}

/** Config-driven preferences for auto selection */
export interface AutoSelectPolicy {
  preferCheap?: boolean;
  preferQuality?: boolean;
  localOnly?: boolean;
  noUpload?: boolean;
}

// ============================================================
// Static Override Table
// ============================================================

interface ModelOverride {
  pattern: RegExp;
  caps: Partial<Pick<ModelCaps, "codingStrength" | "costTier" | "structuredOutput" | "reasoning">>;
}

/**
 * Override table for fields providers don't expose via API.
 * Covers well-known models across all 5 providers.
 * Unknown models get safe defaults (costTier: "mid", codingStrength: "mid").
 */
const MODEL_OVERRIDES: readonly ModelOverride[] = [
  // Anthropic
  { pattern: /claude-opus/i, caps: { codingStrength: "strong", costTier: "premium" } },
  { pattern: /claude-sonnet/i, caps: { codingStrength: "strong", costTier: "mid" } },
  { pattern: /claude-haiku/i, caps: { codingStrength: "mid", costTier: "cheap" } },

  // OpenAI
  { pattern: /gpt-4o(?!-mini)/i, caps: { codingStrength: "strong", costTier: "mid", structuredOutput: true } },
  { pattern: /gpt-4o-mini/i, caps: { codingStrength: "mid", costTier: "cheap", structuredOutput: true } },
  { pattern: /o[134]-(?:mini|preview|pro)/i, caps: { codingStrength: "strong", costTier: "premium", reasoning: true } },
  { pattern: /gpt-4-turbo/i, caps: { codingStrength: "strong", costTier: "mid" } },
  { pattern: /gpt-3\.5/i, caps: { codingStrength: "weak", costTier: "cheap" } },

  // Google
  { pattern: /gemini-2\.\d+-pro/i, caps: { codingStrength: "strong", costTier: "mid" } },
  { pattern: /gemini-2\.\d+-flash(?!-lite)/i, caps: { codingStrength: "mid", costTier: "cheap" } },
  { pattern: /gemini-2\.\d+-flash-lite/i, caps: { codingStrength: "weak", costTier: "cheap" } },
  { pattern: /gemini-1\.5-pro/i, caps: { codingStrength: "strong", costTier: "mid" } },
  { pattern: /gemini-1\.5-flash/i, caps: { codingStrength: "mid", costTier: "cheap" } },

  // Ollama local models
  { pattern: /codellama|code-?llama/i, caps: { codingStrength: "mid", costTier: "free" } },
  { pattern: /deepseek-r1/i, caps: { codingStrength: "strong", costTier: "free", reasoning: true } },
  { pattern: /deepseek-coder/i, caps: { codingStrength: "mid", costTier: "free" } },
  { pattern: /qwen2\.5-coder/i, caps: { codingStrength: "mid", costTier: "free" } },
  { pattern: /llama3\.[\d]/i, caps: { codingStrength: "mid", costTier: "free" } },
  { pattern: /gemma/i, caps: { codingStrength: "mid", costTier: "free" } },
  { pattern: /mistral/i, caps: { codingStrength: "mid", costTier: "free" } },
  { pattern: /phi-?[34]/i, caps: { codingStrength: "mid", costTier: "free" } },

  // Claude Code (passthrough)
  { pattern: /claude-code/i, caps: { codingStrength: "strong", costTier: "premium" } },
] as const;

function lookupOverrides(
  modelId: string,
): Partial<Pick<ModelCaps, "codingStrength" | "costTier" | "structuredOutput" | "reasoning">> {
  for (const entry of MODEL_OVERRIDES) {
    if (entry.pattern.test(modelId)) return entry.caps;
  }
  return {};
}

// ============================================================
// Core Functions
// ============================================================

/** Check if the model string means "auto select" */
export function isAutoModel(model: string): boolean {
  return model === "auto";
}

/** Extract task signals from prompt and attachments using LLM classification. */
export async function buildTaskProfile(
  query: string,
  attachments?: Array<{ kind?: string; mimeType?: string }>,
  policy?: AutoSelectPolicy,
): Promise<TaskProfile> {
  const hasImage = attachments?.some((a) =>
    a.kind === "image" || a.mimeType?.startsWith("image/")
  ) ?? false;

  const { classifyTask } = await import("../runtime/local-llm.ts");
  const classification = await classifyTask(query);

  return {
    hasImage,
    promptIsLarge: query.length > 4000,
    preferCheap: policy?.preferCheap ?? false,
    preferQuality: policy?.preferQuality ?? false,
    localOnly: policy?.localOnly ?? false,
    noUpload: policy?.noUpload ?? false,
    needsStructuredOutput: classification.needsStructuredOutput,
    isCodeTask: classification.isCodeTask,
    isReasoningTask: classification.isReasoningTask,
    estimatedTokens: Math.ceil(query.length / 4),
  };
}

/** Provider preference order for tie-breaking (lower = preferred) */
const PROVIDER_PREFERENCE: Record<string, number> = {
  anthropic: 0,
  openai: 1,
  google: 2,
  "claude-code": 3,
  ollama: 4,
};

function providerPreference(provider: string): number {
  return PROVIDER_PREFERENCE[provider] ?? 5;
}

/** Convert ModelInfo from provider into normalized ModelCaps */
export function modelInfoToModelCaps(modelId: string, info: ModelInfo): ModelCaps {
  const provider = typeof info.metadata?.provider === "string"
    ? info.metadata.provider
    : "";
  const caps = info.capabilities ?? [];
  const isLocal = provider === "ollama" && !info.metadata?.cloud;
  const overrides = lookupOverrides(info.name);

  const tier = classifyModelTier(info, isFrontierProvider(`${provider}/${info.name}`));
  const defaultCodingStrength: CodingStrength = tier === "frontier"
    ? "strong"
    : tier === "weak"
    ? "weak"
    : "mid";

  const costTierFromInfo: CostTier | undefined = info.costTier as CostTier | undefined;
  const apiKeyConfigured = isLocal || info.metadata?.apiKeyConfigured === true;

  return {
    id: modelId,
    provider,
    vision: caps.includes("vision"),
    longContext: (info.contextWindow ?? 0) >= 128_000,
    structuredOutput: overrides.structuredOutput ?? caps.includes("structured.output"),
    toolCalling: caps.includes("tools"),
    local: isLocal,
    costTier: overrides.costTier ?? costTierFromInfo ?? (isLocal ? "free" : "mid"),
    codingStrength: overrides.codingStrength ?? defaultCodingStrength,
    reasoning: overrides.reasoning ?? caps.includes("thinking"),
    apiKeyConfigured,
  };
}

/** Remove models that fail hard constraints */
export function filterModels(
  models: ModelCaps[],
  profile: TaskProfile,
): ModelCaps[] {
  const baseFilter = (m: ModelCaps): boolean => {
    if (!m.apiKeyConfigured) return false;
    // Exclude Claude Code passthrough (:agent suffix) — different execution path
    if (m.id.endsWith(":agent")) return false;
    if (profile.hasImage && !m.vision) return false;
    if (profile.localOnly && !m.local) return false;
    if (!m.toolCalling) return false;
    return true;
  };

  const strong = models.filter((m) => baseFilter(m) && m.codingStrength !== "weak");

  // Fallback: if no mid/strong models, allow weak ones (better suboptimal than nothing)
  if (strong.length === 0) {
    return models.filter(baseFilter);
  }
  return strong;
}

const COST_SCORES: Record<CostTier, number> = {
  free: 4,
  cheap: 3,
  mid: 1,
  premium: 0,
};

const CODING_SCORES: Record<CodingStrength, number> = {
  weak: 0,
  mid: 2,
  strong: 5,
};

/** Additive scoring: higher is better */
export function scoreModel(model: ModelCaps, profile: TaskProfile): number {
  let score = 0;

  // Base coding strength
  score += CODING_SCORES[model.codingStrength];

  // Vision bonus when needed
  if (profile.hasImage && model.vision) score += 3;

  // Long context bonus for large prompts
  if (profile.estimatedTokens > 4000 && model.longContext) score += 2;

  // Cost preference
  if (profile.preferCheap) {
    score += COST_SCORES[model.costTier];
  }

  // Quality preference
  if (profile.preferQuality) {
    score += CODING_SCORES[model.codingStrength]; // double weight
  }

  // Structured output bonus
  if (model.structuredOutput) score += 1;

  // Code task bonus — strong coders get extra credit
  if (profile.isCodeTask && model.codingStrength === "strong") score += 2;

  // Reasoning task bonus — reasoning models shine
  if (profile.isReasoningTask && model.reasoning) score += 3;

  return score;
}

/** Pure entry point: score and rank models, return best + fallbacks */
export async function chooseAutoModel(
  query: string,
  attachments: Array<{ kind?: string; mimeType?: string }> | undefined,
  policy: AutoSelectPolicy | undefined,
  models: ModelInfo[],
): Promise<AutoDecision> {
  const profile = await buildTaskProfile(query, attachments, policy);

  // Convert to ModelCaps
  const allCaps = models.map((info) => {
    const provider = typeof info.metadata?.provider === "string"
      ? info.metadata.provider
      : "";
    const id = provider ? `${provider}/${info.name}` : info.name;
    return modelInfoToModelCaps(id, info);
  });

  // Filter by hard constraints
  const eligible = filterModels(allCaps, profile);
  if (eligible.length === 0) {
    throw new ValidationError(
      "No eligible models found for auto selection. Check that at least one provider is configured with a tool-calling model.",
      "auto_select",
    );
  }

  // Score and sort (descending score, then tie-break by cost/provider)
  const scored = eligible
    .map((m) => ({ caps: m, score: scoreModel(m, profile) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Tie-break: lower cost first
      if (COST_SCORES[b.caps.costTier] !== COST_SCORES[a.caps.costTier]) {
        return COST_SCORES[b.caps.costTier] - COST_SCORES[a.caps.costTier];
      }
      // Tie-break: provider preference order
      return providerPreference(a.caps.provider) -
        providerPreference(b.caps.provider);
    });

  const best = scored[0];
  const fallbacks = scored.slice(1, 3).map((s) => s.caps.id);

  const reasons: string[] = [];
  reasons.push(`coding=${best.caps.codingStrength}`);
  reasons.push(`cost=${best.caps.costTier}`);
  if (profile.hasImage) reasons.push("image-capable");
  if (profile.promptIsLarge) reasons.push("long-context");
  if (profile.isCodeTask) reasons.push("code-task");
  if (profile.isReasoningTask) reasons.push("reasoning-task");
  if (profile.preferCheap) reasons.push("prefer-cheap");
  if (profile.preferQuality) reasons.push("prefer-quality");
  reasons.push(`score=${best.score}`);

  return {
    model: best.caps.id,
    fallbacks,
    reason: `Selected ${best.caps.id} (${reasons.join(", ")})`,
  };
}

// Provider discovery cache — avoids re-querying all providers on every call
let cachedModels: ModelInfo[] | null = null;
let cachedAt = 0;
const MODEL_CACHE_TTL_MS = 60_000; // 1 minute

/** Async wrapper that queries all providers (with caching) then calls chooseAutoModel */
export async function resolveAutoModel(
  query: string,
  attachments?: Array<{ kind?: string; mimeType?: string }>,
  policy?: AutoSelectPolicy,
): Promise<AutoDecision> {
  const now = Date.now();
  if (!cachedModels || now - cachedAt > MODEL_CACHE_TTL_MS) {
    const { listAllProviderModels } = await import("../providers/model-list.ts");
    cachedModels = await listAllProviderModels();
    cachedAt = now;
  }
  return await chooseAutoModel(query, attachments, policy, cachedModels);
}

/** Clear the provider model cache (e.g. after provider config changes). */
export function invalidateAutoModelCache(): void {
  cachedModels = null;
  cachedAt = 0;
}

// ============================================================
// Fallback Mechanism
// ============================================================

/** Last-resort local model fallback (e.g. gemma4:e4b) */
export interface LastResortFallback {
  model: string;
  isAvailable: () => Promise<boolean>;
}

/**
 * Wrap a primary LLM call with model fallback on transient errors.
 * Iterates through fallback models if the primary fails with a fallback-worthy error.
 * When all scored fallbacks are exhausted, tries the local last-resort model if available.
 */
export async function callLLMWithModelFallback(
  primaryCall: () => Promise<LLMResponse>,
  fallbacks: string[],
  createFallbackLLM: (model: string) => LLMFunction,
  callWithRetry: (llmFn: LLMFunction) => Promise<LLMResponse>,
  onTrace?: (event: TraceEvent) => void,
  lastResort?: LastResortFallback,
): Promise<LLMResponse> {
  try {
    return await primaryCall();
  } catch (error) {
    const reason = classifyForLocalFallback(error);
    if (!reason) throw error;

    for (const fallbackModel of fallbacks) {
      onTrace?.({
        type: "auto_fallback",
        fromModel: "primary",
        toModel: fallbackModel,
        reason,
      } as TraceEvent);

      try {
        const fbLLM = createFallbackLLM(fallbackModel);
        return await callWithRetry(fbLLM);
      } catch (fbError) {
        if (!classifyForLocalFallback(fbError)) throw fbError;
        // Continue to next fallback
      }
    }

    // All scored fallbacks exhausted — try local last-resort if available
    if (lastResort && await lastResort.isAvailable()) {
      onTrace?.({
        type: "auto_fallback",
        fromModel: "primary",
        toModel: lastResort.model,
        reason: "last_resort",
      } as TraceEvent);

      const lrLLM = createFallbackLLM(lastResort.model);
      return await callWithRetry(lrLLM);
    }

    throw error;
  }
}
