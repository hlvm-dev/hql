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
// Shell Command Policy Manifest (SSOT)
// ============================================================

/**
 * Declarative shell command security policy.
 *
 * Every allow/deny rule lives here with its regex, the commands it covers,
 * and a human-readable reason. Runtime arrays (SHELL_ALLOWLIST_L0, etc.)
 * are derived from this manifest — never hand-maintained separately.
 *
 * Used by:
 * - security/shell-classifier.ts: classifyShellCommand()
 * - safety.ts: classifyShellExec()
 */

export type ShellTier = "L0" | "L1";

export interface ShellCommandSpec {
  /** Regex pattern matching the command */
  pattern: RegExp;
  /** Commands covered (for audit/testing — must list every command the pattern matches) */
  commands: string[];
  /** Safety tier */
  tier: ShellTier;
}

export interface ShellDenySpec {
  /** Regex pattern that bumps an L0 match to L2 */
  pattern: RegExp;
  /** What this denies (human-readable) */
  reason: string;
}

/**
 * Shell command manifest — single source of truth for L0 and L1 classification.
 *
 * L0: read-only, no side effects, auto-approved (same trust as read_file).
 * L1: low-risk execution (build/test/lint), prompt once per session.
 */
export const SHELL_COMMAND_MANIFEST: readonly ShellCommandSpec[] = [
  // ── L0: Git read-only ──────────────────────────────────────
  { pattern: /^git\s+status\b/,        commands: ["git status"],     tier: "L0" },
  { pattern: /^git\s+log\b/,           commands: ["git log"],        tier: "L0" },
  { pattern: /^git\s+diff\b/,          commands: ["git diff"],       tier: "L0" },
  { pattern: /^git\s+show\b/,          commands: ["git show"],       tier: "L0" },
  { pattern: /^git\s+branch(?:\s+(-a|--all|-r|--remotes|-v|-vv|--verbose|--list)\b)?$/, commands: ["git branch"], tier: "L0" },
  { pattern: /^git\s+tag(?:\s+(-l|--list)\b(?:\s+\S+)?)?$/, commands: ["git tag"],     tier: "L0" },
  { pattern: /^git\s+remote(?:\s+-v)?$/,  commands: ["git remote"],  tier: "L0" },
  { pattern: /^git\s+stash\s+list\b/,  commands: ["git stash list"], tier: "L0" },
  { pattern: /^git\s+shortlog\b/,      commands: ["git shortlog"],   tier: "L0" },
  { pattern: /^git\s+describe\b/,      commands: ["git describe"],   tier: "L0" },
  { pattern: /^git\s+ls-files\b/,      commands: ["git ls-files"],   tier: "L0" },
  { pattern: /^git\s+ls-tree\b/,       commands: ["git ls-tree"],    tier: "L0" },
  { pattern: /^git\s+blame\b/,         commands: ["git blame"],      tier: "L0" },
  { pattern: /^git\s+rev-parse\b/,     commands: ["git rev-parse"],  tier: "L0" },
  { pattern: /^git\s+rev-list\b/,      commands: ["git rev-list"],   tier: "L0" },
  { pattern: /^git\s+name-rev\b/,      commands: ["git name-rev"],   tier: "L0" },
  { pattern: /^git\s+config\s+--?(get|list|l)\b/, commands: ["git config --get", "git config --list"], tier: "L0" },
  { pattern: /^git\s+cat-file\b/,      commands: ["git cat-file"],   tier: "L0" },
  { pattern: /^git\s+count-objects\b/,  commands: ["git count-objects"], tier: "L0" },

  // ── L0: File/dir reading ───────────────────────────────────
  { pattern: /^(ls|cat|head|tail|wc|file|stat|md5|md5sum|shasum|sha256sum)\s/, commands: ["ls", "cat", "head", "tail", "wc", "file", "stat", "md5", "md5sum", "shasum", "sha256sum"], tier: "L0" },
  { pattern: /^(ls|pwd)$/,             commands: ["ls", "pwd"],      tier: "L0" },
  { pattern: /^(readlink|realpath|basename|dirname)\s/, commands: ["readlink", "realpath", "basename", "dirname"], tier: "L0" },

  // ── L0: Search ─────────────────────────────────────────────
  { pattern: /^(find|locate|mdfind)\s/, commands: ["find", "locate", "mdfind"], tier: "L0" },
  { pattern: /^(grep|egrep|fgrep|rg|ag|ack)\s/, commands: ["grep", "egrep", "fgrep", "rg", "ag", "ack"], tier: "L0" },
  { pattern: /^fd\s/,                  commands: ["fd"],             tier: "L0" },

  // ── L0: Dir visualization ──────────────────────────────────
  { pattern: /^tree(\s|$)/,            commands: ["tree"],           tier: "L0" },

  // ── L0: File comparison ────────────────────────────────────
  { pattern: /^(diff|cmp|comm)\s/,     commands: ["diff", "cmp", "comm"], tier: "L0" },

  // ── L0: Text processing (stdout only) ──────────────────────
  { pattern: /^(sort|uniq|tr|cut|paste|fold|column|nl|rev|tac|strings)\s/, commands: ["sort", "uniq", "tr", "cut", "paste", "fold", "column", "nl", "rev", "tac", "strings"], tier: "L0" },

  // ── L0: Data processing (stdout only) ──────────────────────
  { pattern: /^(jq|yq)\s/,            commands: ["jq", "yq"],      tier: "L0" },

  // ── L0: System info (safe subset only) ─────────────────────
  { pattern: /^(pwd|whoami|hostname|uname|date|uptime|which|where|type)\b/, commands: ["pwd", "whoami", "hostname", "uname", "date", "uptime", "which", "where", "type"], tier: "L0" },
  { pattern: /^(echo|printf)\s/,       commands: ["echo", "printf"], tier: "L0" },
  { pattern: /^(df|du)\s/,            commands: ["df", "du"],       tier: "L0" },
  { pattern: /^(man|info)\s/,         commands: ["man", "info"],    tier: "L0" },

  // ── L0: Binary inspection ──────────────────────────────────
  { pattern: /^(xxd|hexdump|od)\s/,   commands: ["xxd", "hexdump", "od"], tier: "L0" },

  // ── L0: Package listing (LOCAL-ONLY, no network) ───────────
  { pattern: /^npm\s+(list|ls)\b/,     commands: ["npm list", "npm ls"], tier: "L0" },
  { pattern: /^pip3?\s+(list|show|freeze)\b/, commands: ["pip list", "pip show", "pip freeze"], tier: "L0" },
  { pattern: /^brew\s+list\b/,         commands: ["brew list"],      tier: "L0" },
  { pattern: /^cargo\s+(tree|metadata)\b/, commands: ["cargo tree", "cargo metadata"], tier: "L0" },
  { pattern: /^go\s+version\b/,        commands: ["go version"],     tier: "L0" },
  { pattern: /^go\s+env(?:\s+[A-Za-z_][A-Za-z0-9_]*)?$/, commands: ["go env"], tier: "L0" },

  // ── L1: Build / test / lint tools ──────────────────────────
  { pattern: /^deno\s+(test|task|fmt|lint|check|bench)\b/, commands: ["deno test", "deno task", "deno fmt", "deno lint", "deno check", "deno bench"], tier: "L1" },
  { pattern: /^npm\s+(test|run|start)\b/, commands: ["npm test", "npm run", "npm start"], tier: "L1" },
  { pattern: /^npx\s/,                 commands: ["npx"],            tier: "L1" },
  { pattern: /^yarn\s+(test|run|start)\b/, commands: ["yarn test", "yarn run", "yarn start"], tier: "L1" },
  { pattern: /^pnpm\s+(test|run|start)\b/, commands: ["pnpm test", "pnpm run", "pnpm start"], tier: "L1" },
  { pattern: /^make(\s|$)/,            commands: ["make"],           tier: "L1" },
  { pattern: /^cargo\s+(test|build|check|clippy|fmt|bench|run)\b/, commands: ["cargo test", "cargo build", "cargo check", "cargo clippy", "cargo fmt", "cargo bench", "cargo run"], tier: "L1" },
  { pattern: /^go\s+(test|build|vet|fmt|run)\b/, commands: ["go test", "go build", "go vet", "go fmt", "go run"], tier: "L1" },
  { pattern: /^python3?\s+(-m\s+)?(pytest|unittest|mypy|flake8|black|ruff)\b/, commands: ["python pytest", "python -m pytest", "python3 -m mypy"], tier: "L1" },
  { pattern: /^(pytest|mypy|eslint|prettier|tsc|biome)\b/, commands: ["pytest", "mypy", "eslint", "prettier", "tsc", "biome"], tier: "L1" },
] as const;

/**
 * Deny-list manifest — patterns that override an L0 match and bump to L2.
 * Catches destructive flags on otherwise-safe commands.
 */
export const SHELL_DENY_MANIFEST: readonly ShellDenySpec[] = [
  { pattern: /^find\s.*\s-delete\b/,                         reason: "find -delete" },
  { pattern: /^find\s.*\s-(exec|execdir|ok|okdir)\b/,        reason: "find -exec/-execdir/-ok/-okdir" },
  { pattern: /^find\s.*\s-exec\s+rm\b/,                      reason: "find -exec rm" },
  { pattern: /^sort\s+(.*\s)?-o\s/,                           reason: "sort -o (in-place output)" },
  { pattern: /^yq\s+(.*\s)?-i\b/,                             reason: "yq -i (in-place edit)" },
  { pattern: /^go\s+env\s+.*\s-w\b/,                          reason: "go env -w (write env var)" },
  { pattern: /^go\s+env\s+-w\b/,                              reason: "go env -w (write env var)" },
  { pattern: /^git\s+branch\s+(.*\s)?-[dD]\b/,                reason: "git branch -d/-D (delete)" },
  { pattern: /^git\s+branch\s+(.*\s)?-[mMcC]\b/,              reason: "git branch -m/-M/-c/-C (move/copy)" },
  { pattern: /^git\s+remote\s+(.*\s)?(add|remove|rm|rename)\b/, reason: "git remote add/remove/rename" },
  { pattern: /^git\s+remote\s+(.*\s)?(set-url|set-head|prune)\b/, reason: "git remote set-url/set-head/prune" },
  { pattern: /^git\s+tag\s+(.*\s)?-d\b/,                      reason: "git tag -d (delete)" },
  { pattern: /^git\s+tag\s+(.*\s)?-[af]\b/,                   reason: "git tag -a/-f (annotate/force)" },
  { pattern: /^git\s+config\s+(?!--?(get|list|l)\b)/,         reason: "git config SET (not get/list)" },
] as const;

// ── Derived runtime arrays (DO NOT edit — generated from manifests above) ──

/** L0 shell commands — read-only, no side effects, auto-approved */
export const SHELL_ALLOWLIST_L0: readonly RegExp[] =
  SHELL_COMMAND_MANIFEST.filter(s => s.tier === "L0").map(s => s.pattern);

/** L1 shell commands — low risk, prompt once per session */
export const SHELL_ALLOWLIST_L1: readonly RegExp[] =
  SHELL_COMMAND_MANIFEST.filter(s => s.tier === "L1").map(s => s.pattern);

/** Deny patterns that override L0 — destructive flags on otherwise-safe commands */
export const SHELL_DENYLIST_L0: readonly RegExp[] =
  SHELL_DENY_MANIFEST.map(s => s.pattern);

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

/** Max session history exchange groups to load (prevents mid-tool-exchange resume) */
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

export const GROUNDING_MODES = ["off", "warn", "strict"] as const;
export type GroundingMode = typeof GROUNDING_MODES[number];

export function isGroundingMode(value: unknown): value is GroundingMode {
  return GROUNDING_MODES.includes(value as GroundingMode);
}

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

export function resolveExecutionModelTier(
  model?: string,
  modelInfo?: { parameterSize?: string; contextWindow?: number } | null,
): ModelTier {
  return classifyModelTier(modelInfo, isFrontierProvider(model));
}

export function supportsAgentExecution(
  model?: string,
  modelInfo?: { parameterSize?: string; contextWindow?: number } | null,
): boolean {
  return resolveExecutionModelTier(model, modelInfo) !== "weak";
}

/** Default tool denylist for interactive ask mode */
export const DEFAULT_TOOL_DENYLIST = [
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
  "search_code", "ask_user", "complete_task",
  "git_status", "git_diff", "git_log",
  "search_web", "web_fetch", "fetch_url",
  "memory_write", "memory_search", "memory_edit",
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
