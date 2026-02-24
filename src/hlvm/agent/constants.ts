/**
 * Agent Constants - SSOT for agent configuration
 *
 * Consolidates all agent-related constants and configurations
 * into a single source of truth.
 *
 * Eliminates duplications:
 * - Shell allow-list: shell-tools.ts:69-74 + safety.ts:284-289 (2x)
 * - Timeout values: orchestrator.ts + safety.ts (scattered)
 * - Max iterations: orchestrator.ts:696 (1x, now centralized)
 *
 * Features:
 * - SSOT for all agent configuration
 * - Type-safe constants
 * - Clear documentation
 * - Easy to modify (single location)
 */

// ============================================================
// Shell Command Allow-List (L1 Safety Level)
// ============================================================

/**
 * Allow-list for L1 (confirm once) shell commands
 *
 * These commands are read-only and safe to execute after single confirmation.
 * Everything else defaults to L2 (always confirm).
 *
 * Used by:
 * - security/shell-classifier.ts: classifyShellCommand()
 * - safety.ts: classifyShellExec()
 *
 * L1 commands:
 * - `git status`: Show working tree status (read-only)
 * - `git log`: Show commit history (read-only, any args allowed)
 * - `git diff`: Show changes (read-only, any args allowed)
 * - `deno test --dry-run`: Show tests without running (must have --dry-run flag)
 *
 * @example
 * ```ts
 * import { SHELL_ALLOWLIST_L1 } from "./constants.ts";
 *
 * function classifyCommand(cmd: string): "L1" | "L2" {
 *   for (const pattern of SHELL_ALLOWLIST_L1) {
 *     if (pattern.test(cmd)) return "L1";
 *   }
 *   return "L2";
 * }
 * ```
 */
/**
 * L0 shell commands — read-only, no side effects, auto-approved.
 * Same trust level as read_file / list_files / open_path.
 */
export const SHELL_ALLOWLIST_L0: readonly RegExp[] = [
  // Git read-only
  /^git\s+status$/,
  /^git\s+log/,
  /^git\s+diff/,
  // File/dir reading (same data as read_file / list_files)
  /^(ls|cat|head|tail|wc|file|stat|md5|shasum)\s/,
  /^(ls|pwd)$/,
  // Search (same data as search_code / list_files)
  /^(find|locate|mdfind)\s/,
  // Open (same as open_path)
  /^open\s/,
  // System info (read-only, no side effects)
  /^(pwd|whoami|hostname|uname|date|uptime|which|where|type)\b/,
  /^(top\s+-l\s|vm_stat|sysctl\s|sw_vers|system_profiler)/,
  /^(ps\s+(aux|ef|ax)|ps$)/,
  /^(df|du)\s/,
  /^(echo|printf)\s/,
] as const;

/**
 * L1 shell commands — low risk but not purely read-only, prompt once per session.
 */
export const SHELL_ALLOWLIST_L1: readonly RegExp[] = [
  // Build tools (dry-run only)
  /^deno\s+test\s+.*--dry-run/,
] as const;

// ============================================================
// Timeout Configuration
// ============================================================

/**
 * Default timeout values for agent operations
 *
 * Used by:
 * - orchestrator.ts: LLM calls and tool execution
 * - safety.ts: User confirmation prompts
 *
 * Values chosen based on:
 * - LLM timeout: 30s allows complex reasoning without hanging
 * - Tool timeout: 60s allows slow operations (network, builds)
 * - User input timeout: 60s reasonable time for human response
 * - Total timeout: 5min prevents infinite loops
 *
 * All values in milliseconds.
 *
 * @example
 * ```ts
 * import { DEFAULT_TIMEOUTS } from "./constants.ts";
 *
 * const timeout = config.llmTimeout ?? DEFAULT_TIMEOUTS.llm;
 * ```
 */
export const DEFAULT_TIMEOUTS = {
  /** LLM call timeout (default: 120000ms = 120 seconds; frontier models need more time) */
  llm: 120_000,

  /** Tool execution timeout (default: 60000ms = 60 seconds) */
  tool: 60000,

  /** User input/confirmation timeout (default: 60000ms = 60 seconds) */
  userInput: 60000,

  /** Total agent loop timeout (default: 300000ms = 5 minutes) */
  total: 300000,
} as const;

// ============================================================
// Loop Limits
// ============================================================

/**
 * Maximum iterations for agent ReAct loop
 *
 * Prevents infinite loops where agent keeps calling tools without progress.
 * Set conservatively - most tasks complete in < 10 iterations.
 *
 * Used by:
 * - orchestrator.ts: Main agent loop
 *
 * @example
 * ```ts
 * import { MAX_ITERATIONS } from "./constants.ts";
 *
 * while (iterations < MAX_ITERATIONS) {
 *   // Agent loop
 * }
 * ```
 */
export const MAX_ITERATIONS = 20;

/**
 * Maximum retries for failed LLM calls
 *
 * Handles transient errors (network issues, rate limits).
 * Uses exponential backoff between retries.
 *
 * Used by:
 * - orchestrator.ts: LLM call retry logic
 *
 * @example
 * ```ts
 * import { MAX_RETRIES } from "./constants.ts";
 *
 * const retries = config.maxRetries ?? MAX_RETRIES;
 * ```
 */
export const MAX_RETRIES = 3;

/**
 * Default maximum tool calls per turn
 *
 * Used by:
 * - orchestrator.ts: runReActLoop
 * - cli/ask.ts: default max-calls
 */
export const DEFAULT_MAX_TOOL_CALLS = 50;

// ============================================================
// Resource Limits
// ============================================================

/**
 * Resource limits for agent operations
 *
 * These limits prevent runaway memory/CPU usage and DoS from
 * extremely large files or huge result sets.
 */
export const RESOURCE_LIMITS = {
  /** Max bytes allowed for single file read (default: 2MB) */
  maxReadBytes: 2 * 1024 * 1024,

  /** Max bytes allowed for single file write (default: 2MB) */
  maxWriteBytes: 2 * 1024 * 1024,

  /** Max entries returned from list_files (default: 5000) */
  maxListEntries: 5000,

  /** Max search results returned from search_code (default: 5000) */
  maxSearchResults: 5000,

  /** Max bytes allowed to scan per file in search_code (default: 1MB) */
  maxSearchFileBytes: 1 * 1024 * 1024,

  /** Max files scanned in find_symbol (default: 5000) */
  maxSymbolFiles: 5000,

  /** Max total tool result bytes per run (default: 2MB) */
  maxTotalToolResultBytes: 2 * 1024 * 1024,
} as const;

// ============================================================
// Rate Limits
// ============================================================

/**
 * Rate limits for agent operations (per sliding window)
 *
 * Defaults are conservative but should not impact normal usage.
 */
export const RATE_LIMITS = {
  /** Max LLM calls per minute */
  llmCalls: { maxCalls: 60, windowMs: 60_000 },
  /** Max tool calls per minute */
  toolCalls: { maxCalls: 120, windowMs: 60_000 },
} as const;

// ============================================================
// Context Budget
// ============================================================

/** Reserve for output tokens (absolute, subtracted from raw limit) */
export const OUTPUT_RESERVE_TOKENS = 4096;

/** Conservative fallback context window when no info is available */
export const DEFAULT_CONTEXT_WINDOW = 32_000;

// ============================================================
// Context Compaction
// ============================================================

/** Trigger LLM-powered context compaction at this fraction of maxTokens */
export const COMPACTION_THRESHOLD = 0.8;

// ============================================================
// Context Defaults + Engine Profiles
// ============================================================

/**
 * Default context configuration
 *
 * Used by:
 * - context.ts: ContextManager defaults
 */
export const DEFAULT_CONTEXT_CONFIG = {
  maxTokens: DEFAULT_CONTEXT_WINDOW,
  maxResultLength: 8000,
  preserveSystem: true,
  minMessages: 2,
  overflowStrategy: "summarize",
  summaryMaxChars: 1200,
  summaryKeepRecent: 4,
  compactionThreshold: COMPACTION_THRESHOLD,
} as const;

/**
 * Engine profiles for deterministic behavior
 *
 * Used by:
 * - cli/ask.ts: default profile
 */
export const ENGINE_PROFILES = {
  normal: {
    maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
    groundingMode: "off",
    context: {
      ...DEFAULT_CONTEXT_CONFIG,
    },
  },
  strict: {
    maxToolCalls: 5,
    groundingMode: "warn",
    context: {
      ...DEFAULT_CONTEXT_CONFIG,
      maxTokens: 16000,
      overflowStrategy: "fail",
    },
  },
} as const;

// ============================================================
// Agent Defaults
// ============================================================

/** Max session history messages to load (prevents context pollution) */
export const MAX_SESSION_HISTORY = 10;

/** Cloud/frontier provider prefixes (SSOT for detectFrontierModel + isLocalModel) */
export const FRONTIER_PROVIDER_PREFIXES = ["anthropic", "openai", "google", "claude-code"] as const;

/** Extract provider prefix from "provider/model" string */
export function extractProviderName(model?: string): string {
  if (!model) return "unknown";
  const slashIdx = model.indexOf("/");
  return slashIdx > 0 ? model.slice(0, slashIdx).toLowerCase() : "ollama";
}

/** Extract model name from "provider/model" string */
export function extractModelSuffix(model?: string): string {
  if (!model) return "unknown";
  const slashIdx = model.indexOf("/");
  return slashIdx > 0 ? model.slice(slashIdx + 1) : model;
}

/** Detect whether a model string refers to a frontier API model */
export function isFrontierProvider(model?: string): boolean {
  if (!model) return false;
  const prefix = extractProviderName(model);
  return (FRONTIER_PROVIDER_PREFIXES as readonly string[]).includes(prefix);
}

// ============================================================
// Model Tier Classification
// ============================================================

export type ModelTier = "weak" | "mid" | "frontier";

/** Returns true if `tier` meets or exceeds `minTier`. */
export function tierMeetsMinimum(tier: ModelTier, minTier: ModelTier): boolean {
  const order: Record<ModelTier, number> = { weak: 0, mid: 1, frontier: 2 };
  return order[tier] >= order[minTier];
}

/**
 * Classify a model into weak / mid / frontier tier.
 *
 * - frontier: any API-hosted provider (anthropic/openai/google/claude-code)
 * - weak: local model with <13B parameters
 * - mid: everything else (safe default)
 */
export function classifyModelTier(
  modelInfo?: { parameterSize?: string; contextWindow?: number } | null,
  isFrontier?: boolean,
): ModelTier {
  if (isFrontier) return "frontier";
  if (modelInfo?.parameterSize) {
    const match = modelInfo.parameterSize.match(/^(\d+(?:\.\d+)?)\s*[bB]/);
    if (match && parseFloat(match[1]) < 13) return "weak";
    if (match) return "mid";
  }
  if (modelInfo?.contextWindow && modelInfo.contextWindow >= 128_000) {
    return "frontier";
  }
  return "mid"; // safe default
}

/** Default tool denylist for interactive ask mode */
export const DEFAULT_TOOL_DENYLIST = [
  "delegate_agent",
  "complete_task",
] as const;

// ============================================================
// Weak-Tier Tool Cap
// ============================================================

/**
 * Core tools for weak-tier models (< 13B params).
 * Keeps tool count low to avoid context overflow and tool selection confusion.
 * Mid/frontier models get ALL tools (no cap).
 */
export const WEAK_TIER_CORE_TOOLS: readonly string[] = [
  "read_file", "write_file", "edit_file", "list_files",
  "search_code", "shell_exec", "ask_user", "complete_task",
  "git_status", "git_diff", "git_log", "git_commit",
  "memory_write", "memory_search",
] as const;

/**
 * Compute tier-aware tool filter.
 * - weak: restricts to WEAK_TIER_CORE_TOOLS (unless user provides explicit allowlist)
 * - mid/frontier: passthrough (no filtering)
 */
export function computeTierToolFilter(
  tier: ModelTier,
  userAllowlist?: string[],
  userDenylist?: string[],
): { allowlist?: string[]; denylist?: string[] } {
  if (tier !== "weak") return { allowlist: userAllowlist, denylist: userDenylist };
  const baseAllowlist = userAllowlist?.length ? userAllowlist : [...WEAK_TIER_CORE_TOOLS];
  return { allowlist: baseAllowlist, denylist: userDenylist };
}
