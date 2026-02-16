/**
 * Context Resolver — Simple synchronous context window budget resolution
 *
 * Priority chain: userOverride → modelInfo.contextWindow → 32K fallback
 * Budget = rawLimit - OUTPUT_RESERVE_TOKENS (absolute 4096 reserve)
 *
 * SSOT for context budget resolution across CLI and GUI.
 */

import type { ModelInfo } from "../providers/types.ts";
import { getAgentLogger } from "./logger.ts";
import {
  DEFAULT_CONTEXT_WINDOW,
  OUTPUT_RESERVE_TOKENS,
} from "./constants.ts";

// ============================================================================
// Types
// ============================================================================

export interface ResolveContextBudgetOptions {
  /** ModelInfo from provider.models.get() — may contain contextWindow */
  modelInfo?: ModelInfo;
  /** User config override (config.contextWindow) */
  userOverride?: number;
}

export interface ResolvedBudget {
  /** Effective token budget for context (rawLimit - output reserve) */
  budget: number;
  /** Raw context window limit before output reserve */
  rawLimit: number;
  /** Source of the resolved limit */
  source: "user_override" | "model_info" | "default";
}

// ============================================================================
// Resolver
// ============================================================================

/**
 * Resolve the effective context window budget for a model.
 *
 * Priority chain (first non-null wins):
 * 1. User config override
 * 2. Provider API metadata (modelInfo.contextWindow)
 * 3. Conservative fallback: 32K
 *
 * Returns: budget = rawLimit - OUTPUT_RESERVE_TOKENS (absolute 4096 reserve)
 */
export function resolveContextBudget(
  opts: ResolveContextBudgetOptions = {},
): ResolvedBudget {
  const log = getAgentLogger();

  // 1. User override — highest priority
  if (opts.userOverride && opts.userOverride > 0) {
    const budget = Math.max(0, opts.userOverride - OUTPUT_RESERVE_TOKENS);
    log.debug?.(`Context budget: user override ${opts.userOverride} → ${budget}`);
    return { budget, rawLimit: opts.userOverride, source: "user_override" };
  }

  // 2. Provider API metadata
  if (opts.modelInfo?.contextWindow && opts.modelInfo.contextWindow > 0) {
    const rawLimit = opts.modelInfo.contextWindow;
    const budget = Math.max(0, rawLimit - OUTPUT_RESERVE_TOKENS);
    log.debug?.(`Context budget: model info ${rawLimit} → ${budget}`);
    return { budget, rawLimit, source: "model_info" };
  }

  // 3. Conservative fallback
  const budget = Math.max(0, DEFAULT_CONTEXT_WINDOW - OUTPUT_RESERVE_TOKENS);
  log.debug?.(`Context budget: fallback → ${budget}`);
  return { budget, rawLimit: DEFAULT_CONTEXT_WINDOW, source: "default" };
}
