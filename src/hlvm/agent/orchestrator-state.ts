/**
 * Orchestrator state types and initialization.
 * Extracted from orchestrator.ts for modularity.
 */

import {
  DEFAULT_TIMEOUTS,
  type GroundingMode,
  MAX_ITERATIONS,
  MAX_RETRIES,
  type ModelTier,
  RATE_LIMITS,
  RESOURCE_LIMITS,
} from "./constants.ts";
import {
  type RateLimitConfig,
  SlidingWindowRateLimiter,
} from "../../common/rate-limiter.ts";
import { type PlanningConfig, type PlanState } from "./planning.ts";
import type { ToolUse } from "./grounding.ts";
import { UsageTracker } from "./usage.ts";
import { assertMaxBytes } from "../../common/limits.ts";
import type { OrchestratorConfig } from "./orchestrator.ts";
import type { CitationSourceEntry } from "./tools/web/citation-spans.ts";
import type { EditFileRecovery } from "./error-taxonomy.ts";
import type { RuntimeToolPhase } from "./orchestrator.ts";

/** Result of tool execution */
export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  llmContent?: string;
  summaryDisplay?: string;
  returnDisplay?: string;
  error?: string;
  stopReason?: "plan_review_cancelled";
  recovery?: EditFileRecovery;
}

/** Mutable state for the ReAct loop, consolidated from 16 local variables */
/** @internal Exported for unit testing of maybeInjectReminder */
export interface LoopState {
  iterations: number;
  usageTracker: UsageTracker;
  denialCountByTool: Map<string, number>;
  totalToolResultBytes: number;
  toolUses: ToolUse[];
  groundingRetries: number;
  noInputRetries: number;
  toolCallRetries: number;
  midLoopFormatRetries: number;
  finalResponseFormatRetries: number;
  lastToolSignature: string;
  repeatToolCount: number;
  consecutiveToolFailures: number;
  emptyResponseRetried: boolean;
  planState: PlanState | null;
  lastResponse: string;
  /** Whether the most recent tool execution included web tools */
  lastToolsIncludedWeb: boolean;
  /** Iterations since last mid-conversation reminder */
  iterationsSinceReminder: number;
  /** Whether memory flush was already injected this cycle (pre-compaction) */
  memoryFlushedThisCycle: boolean;
  /** Whether automatic memory recall has already been injected for this user turn */
  memoryRecallInjected: boolean;
  /** Dedupes lead-side team summary reminders injected into context. */
  lastTeamSummarySignature: string;
  /** Whether a delegation hint has already been injected this session */
  delegationHintInjected?: boolean;
  /** Indexed citation candidates extracted from recent web tool results. */
  passageIndex?: CitationSourceEntry[];
  /** Counter for consecutive transient network retries at the loop level */
  consecutiveTransientRetries?: number;
  /** Most recent tool names executed in the prior iteration. */
  lastToolNames: string[];
  /** Latest tool_search-derived allowlist override. */
  toolSearchAllowlist?: string[];
  /** Current adaptive execution phase. */
  runtimePhase?: RuntimeToolPhase;
  /** Loop recovery escalation level for the current repeated signature. */
  loopRecoveryStep: number;
  /** Signature currently being recovered from. */
  loopRecoverySignature?: string;
  /** Temporary per-tool denylist with remaining-turn TTLs. */
  temporaryToolDenylist: Map<string, number>;
}

/** Resolved constants from OrchestratorConfig, computed once at loop start.
 *  @internal Exported for unit testing of maybeInjectReminder */
export interface LoopConfig {
  maxIterations: number;
  maxDenials: number;
  llmTimeout: number;
  maxRetries: number;
  groundingMode: GroundingMode;
  llmLimiter: SlidingWindowRateLimiter | null;
  toolRateLimiter: SlidingWindowRateLimiter | null;
  maxToolResultBytes: number;
  skipCompensation: boolean;
  maxGroundingRetries: number;
  noInputEnabled: boolean;
  maxNoInputRetries: number;
  requireToolCalls: boolean;
  maxToolCallRetries: number;
  maxRepeatToolCalls: number;
  planningConfig: PlanningConfig;
  loopDeadline: number;
  totalTimeout: number;
  modelTier: ModelTier;
}

/** Control flow directive from extracted loop functions */
export type LoopDirective =
  | { action: "continue" }
  | { action: "return"; value: string }
  | { action: "proceed" };

export function createRateLimiter(
  config: RateLimitConfig | undefined,
): SlidingWindowRateLimiter | null {
  if (!config) return null;
  if (config.maxCalls <= 0 || config.windowMs <= 0) return null;
  return new SlidingWindowRateLimiter(config);
}

/** Clone a string list shallowly, returning undefined for empty/missing lists. */
export function cloneToolList(list?: string[]): string[] | undefined {
  return list?.length ? [...list] : undefined;
}

/** Create initial mutable loop state from config */
export function initializeLoopState(config: OrchestratorConfig): LoopState {
  const usageTracker = config.usage ?? new UsageTracker();
  return {
    iterations: 0,
    usageTracker,
    denialCountByTool: new Map(),
    totalToolResultBytes: 0,
    toolUses: [],
    groundingRetries: 0,
    noInputRetries: 0,
    toolCallRetries: 0,
    midLoopFormatRetries: 0,
    finalResponseFormatRetries: 0,
    lastToolSignature: "",
    repeatToolCount: 0,
    consecutiveToolFailures: 0,
    emptyResponseRetried: false,
    planState: config.initialPlanState ?? null,
    lastResponse: "",
    lastToolsIncludedWeb: false,
    iterationsSinceReminder: 3, // Start at cooldown to avoid immediate reminder
    memoryFlushedThisCycle: false,
    memoryRecallInjected: false,
    lastTeamSummarySignature: "",
    delegationHintInjected: false,
    passageIndex: [],
    lastToolNames: [],
    loopRecoveryStep: 0,
    temporaryToolDenylist: new Map(),
  };
}

/** Resolve config constants once at loop start */
export function resolveLoopConfig(config: OrchestratorConfig): LoopConfig {
  const groundingMode = config.groundingMode ?? "off";
  const llmRateConfig = config.llmRateLimit ?? RATE_LIMITS.llmCalls;
  const llmLimiter = config.llmRateLimiter ?? createRateLimiter(llmRateConfig);
  const toolRateLimiter = config.toolRateLimiter ??
    createRateLimiter(config.toolRateLimit ?? RATE_LIMITS.toolCalls);
  const totalTimeout = config.totalTimeout ?? DEFAULT_TIMEOUTS.total;
  return {
    maxIterations: config.maxIterations ?? MAX_ITERATIONS,
    maxDenials: config.maxDenials ?? 3,
    llmTimeout: config.llmTimeout ?? DEFAULT_TIMEOUTS.llm,
    maxRetries: config.maxRetries ?? MAX_RETRIES,
    groundingMode,
    llmLimiter,
    toolRateLimiter,
    maxToolResultBytes: config.maxTotalToolResultBytes ??
      RESOURCE_LIMITS.maxTotalToolResultBytes,
    skipCompensation: config.skipModelCompensation ?? false,
    maxGroundingRetries: groundingMode === "strict" ? 1 : 0,
    noInputEnabled: config.noInput ?? false,
    maxNoInputRetries: 1,
    requireToolCalls: config.requireToolCalls ?? false,
    maxToolCallRetries: config.maxToolCallRetries ?? 2,
    maxRepeatToolCalls: config.maxToolCallRepeat ?? 3,
    planningConfig: config.planning ?? { mode: "off" },
    loopDeadline: Date.now() + totalTimeout,
    totalTimeout,
    modelTier: config.modelTier ?? "mid",
  };
}

/** Accumulate tool result bytes and throw if limit exceeded */
export function checkToolResultBytesLimit(
  state: LoopState,
  lc: LoopConfig,
  config: OrchestratorConfig,
  delta: number,
): void {
  state.totalToolResultBytes += delta;
  if (lc.maxToolResultBytes > 0) {
    try {
      assertMaxBytes(
        "total tool result bytes",
        state.totalToolResultBytes,
        lc.maxToolResultBytes,
      );
    } catch (error) {
      config.onTrace?.({
        type: "resource_limit",
        kind: "tool_result_bytes",
        limit: lc.maxToolResultBytes,
        used: state.totalToolResultBytes,
      });
      throw error;
    }
  }
}

/** Resolve the effective tool allowlist from OrchestratorConfig. */
export function effectiveAllowlist(
  config: OrchestratorConfig,
): string[] | undefined {
  return config.toolFilterState?.allowlist ?? config.toolAllowlist;
}

/** Resolve the effective tool denylist from OrchestratorConfig. */
export function effectiveDenylist(
  config: OrchestratorConfig,
): string[] | undefined {
  return config.toolFilterState?.denylist ?? config.toolDenylist;
}
