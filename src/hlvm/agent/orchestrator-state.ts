/** Orchestrator state types and initialization. */

import {
  DEFAULT_TIMEOUTS,
  type GroundingMode,
  MAX_ITERATIONS,
  type ModelCapabilityClass,
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
import type {
  AgentStopReason,
  OrchestratorConfig,
  RuntimeToolPhase,
} from "./orchestrator.ts";
import type { CitationSourceEntry } from "./tools/web/citation-spans.ts";
import type { EditFileRecovery } from "./error-taxonomy.ts";
import type { ToolPresentationKind } from "./registry.ts";
import type { ToolFailureMetadata } from "./tool-results.ts";
import {
  cloneToolList,
  mergeDenylists,
  resolveEffectiveToolFilterCached,
  type ToolProfileState,
} from "./tool-profiles.ts";

/** Result of tool execution */
export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  llmContent?: string;
  summaryDisplay?: string;
  returnDisplay?: string;
  presentationKind?: ToolPresentationKind;
  truncatedForLlm?: boolean;
  truncatedForTranscript?: boolean;
  error?: string;
  failure?: ToolFailureMetadata;
  diagnosticText?: string;
  stopReason?: "plan_review_cancelled";
  recovery?: EditFileRecovery;
  /** Image attachments from tools like cu_screenshot (base64 JPEG). */
  imageAttachments?: Array<{
    data: string;
    mimeType: string;
    width?: number;
    height?: number;
  }>;
}

/** Browser/Playwright-specific loop state, grouped for clarity. */
export interface PlaywrightLoopState {
  /** Most recent repeated Playwright failure signature. */
  lastFailureSignature?: string;
  /** Consecutive iterations with the same Playwright failure signature. */
  repeatFailureCount: number;
  /** Most recent Playwright recovery stage already nudged. */
  notifiedRecoveryKey?: string;
  /** Consecutive turns spent only on Playwright visual browsing tools. */
  repeatVisualLoopCount: number;
  /** Whether the current Playwright visual loop already received a nudge. */
  notifiedVisualLoop: boolean;
  /** Retries for browser final-answer adequacy gate. */
  finalAnswerRetries: number;
  /** Temporary per-tool denylist with remaining-turn TTLs. */
  temporaryToolDenylist: Map<string, number>;
}

/** Mutable state for the ReAct loop. */
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
  /** Memory file paths already surfaced this loop, to avoid double-injection */
  surfacedMemoryPaths: Set<string>;
  /** Whether available skills have already been injected for this user turn */
  skillsInjected: boolean;
  /** Indexed citation candidates extracted from recent web tool results. */
  passageIndex?: CitationSourceEntry[];
  /** Counter for consecutive transient network retries at the loop level */
  consecutiveTransientRetries?: number;
  /** Most recent tool names executed in the prior iteration. */
  lastToolNames: string[];
  /** Current adaptive execution phase. */
  runtimePhase?: RuntimeToolPhase;
  /** Loop recovery escalation level for the current repeated signature. */
  loopRecoveryStep: number;
  /** Signature currently being recovered from. */
  loopRecoverySignature?: string;
  /** Browser/Playwright-specific state. */
  playwright: PlaywrightLoopState;
  /** Whether this turn required automatic output continuation. */
  continuedThisTurn: boolean;
  /** Number of continuation hops used in this turn. */
  continuationCount: number;
  /** Most recent compaction reason observed in this turn. */
  compactionReason?: "proactive_pressure" | "overflow_retry";
  /** Message revision at the last proactive compaction boundary. */
  lastProactiveCompactionMessageRevision?: number;
  /**
   * Cached request-phase classification for the constant user request.
   * Populated lazily on first use by `applyAdaptiveToolPhase` so the local
   * classifier runs at most once per turn.
   */
  requestPhaseClassification?: {
    phase: RuntimeToolPhase;
  };
}

/** Resolved constants from OrchestratorConfig, computed once at loop start.
 *  @internal Exported for unit testing of maybeInjectReminder */
export interface LoopConfig {
  maxIterations: number;
  maxDenials: number;
  llmTimeout: number;
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
  modelCapability: ModelCapabilityClass;
}

/** Control flow directive from extracted loop functions */
export type LoopDirective =
  | { action: "continue" }
  | { action: "return"; value: string; stopReason?: AgentStopReason }
  | { action: "proceed" };

export function createRateLimiter(
  config: RateLimitConfig | undefined,
): SlidingWindowRateLimiter | null {
  if (!config) return null;
  if (config.maxCalls <= 0 || config.windowMs <= 0) return null;
  return new SlidingWindowRateLimiter(config);
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
    surfacedMemoryPaths: new Set<string>(),
    skillsInjected: false,
    passageIndex: [],
    lastToolNames: [],
    loopRecoveryStep: 0,
    playwright: {
      repeatFailureCount: 0,
      repeatVisualLoopCount: 0,
      notifiedVisualLoop: false,
      finalAnswerRetries: 0,
      temporaryToolDenylist: new Map(),
    },
    continuedThisTurn: false,
    continuationCount: 0,
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
    modelCapability: config.modelCapability ?? "agent",
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
  if (config.toolProfileState) {
    return resolveEffectiveToolFilterCached(config.toolProfileState).allowlist;
  }
  return config.toolAllowlist;
}

/** Resolve the effective tool denylist from OrchestratorConfig. */
export function effectiveDenylist(
  config: OrchestratorConfig,
): string[] | undefined {
  if (config.toolProfileState) {
    return mergeDenylists(
      resolveEffectiveToolFilterCached(config.toolProfileState).denylist,
      config.toolDenylist,
    );
  }
  return config.toolDenylist;
}

export type { ToolProfileState };
export { cloneToolList };
