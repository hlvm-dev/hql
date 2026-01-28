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
 * - shell-tools.ts: classifyShellCommand()
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
export const SHELL_ALLOWLIST_L1: readonly RegExp[] = [
  /^git\s+status$/,           // Exact match: "git status" only
  /^git\s+log/,               // Prefix match: "git log" with any args
  /^git\s+diff/,              // Prefix match: "git diff" with any args
  /^deno\s+test\s+.*--dry-run/,  // Must contain "--dry-run" flag
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
  /** LLM call timeout (default: 30000ms = 30 seconds) */
  llm: 30000,

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
 * - orchestrator.ts: parseToolCalls + runReActLoop
 * - cli/ask.ts: default max-calls
 */
export const DEFAULT_MAX_TOOL_CALLS = 10;

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
// Context Defaults + Engine Profiles
// ============================================================

/**
 * Default context configuration
 *
 * Used by:
 * - context.ts: ContextManager defaults
 */
export const DEFAULT_CONTEXT_CONFIG = {
  maxTokens: 12000,
  maxResultLength: 5000,
  preserveSystem: true,
  minMessages: 2,
  overflowStrategy: "trim",
  summaryMaxChars: 1200,
  summaryKeepRecent: 4,
} as const;

/**
 * Engine profiles for deterministic behavior
 *
 * Used by:
 * - cli/ask.ts: --engine-strict and default profile
 */
export const ENGINE_PROFILES = {
  normal: {
    maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
    groundingMode: "off",
    context: {
      maxTokens: 8000,
      overflowStrategy: "trim",
    },
  },
  strict: {
    maxToolCalls: 5,
    groundingMode: "strict",
    context: {
      maxTokens: 4000,
      overflowStrategy: "fail",
    },
  },
} as const;

export type EngineProfileName = keyof typeof ENGINE_PROFILES;

// ============================================================
// Type Exports
// ============================================================

/**
 * Type-safe timeout keys
 */
export type TimeoutKey = keyof typeof DEFAULT_TIMEOUTS;

/**
 * Type-safe timeout configuration
 */
export type TimeoutConfig = {
  [K in TimeoutKey]?: number;
};
