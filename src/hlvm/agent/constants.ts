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

import { extractProvider } from "../providers/approval.ts";
import { AGENT_TOOL_NAME } from "./tools/agent-constants.ts";

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

type ShellTier = "L0" | "L1";

interface ShellCommandSpec {
  /** Regex pattern matching the command */
  pattern: RegExp;
  /** Commands covered (for audit/testing — must list every command the pattern matches) */
  commands: string[];
  /** Safety tier */
  tier: ShellTier;
}

interface ShellDenySpec {
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
const SHELL_COMMAND_MANIFEST: readonly ShellCommandSpec[] = [
  // ── L0: Git read-only ──────────────────────────────────────
  { pattern: /^git\s+status\b/, commands: ["git status"], tier: "L0" },
  { pattern: /^git\s+log\b/, commands: ["git log"], tier: "L0" },
  { pattern: /^git\s+diff\b/, commands: ["git diff"], tier: "L0" },
  { pattern: /^git\s+show\b/, commands: ["git show"], tier: "L0" },
  {
    pattern:
      /^git\s+branch(?:\s+(-a|--all|-r|--remotes|-v|-vv|--verbose|--list)\b)?$/,
    commands: ["git branch"],
    tier: "L0",
  },
  {
    pattern: /^git\s+tag(?:\s+(-l|--list)\b(?:\s+\S+)?)?$/,
    commands: ["git tag"],
    tier: "L0",
  },
  { pattern: /^git\s+remote(?:\s+-v)?$/, commands: ["git remote"], tier: "L0" },
  {
    pattern: /^git\s+stash\s+list\b/,
    commands: ["git stash list"],
    tier: "L0",
  },
  { pattern: /^git\s+shortlog\b/, commands: ["git shortlog"], tier: "L0" },
  { pattern: /^git\s+describe\b/, commands: ["git describe"], tier: "L0" },
  { pattern: /^git\s+ls-files\b/, commands: ["git ls-files"], tier: "L0" },
  { pattern: /^git\s+ls-tree\b/, commands: ["git ls-tree"], tier: "L0" },
  { pattern: /^git\s+blame\b/, commands: ["git blame"], tier: "L0" },
  { pattern: /^git\s+rev-parse\b/, commands: ["git rev-parse"], tier: "L0" },
  { pattern: /^git\s+rev-list\b/, commands: ["git rev-list"], tier: "L0" },
  { pattern: /^git\s+name-rev\b/, commands: ["git name-rev"], tier: "L0" },
  {
    pattern: /^git\s+config\s+--?(get|list|l)\b/,
    commands: ["git config --get", "git config --list"],
    tier: "L0",
  },
  { pattern: /^git\s+cat-file\b/, commands: ["git cat-file"], tier: "L0" },
  {
    pattern: /^git\s+count-objects\b/,
    commands: ["git count-objects"],
    tier: "L0",
  },

  // ── L0: File/dir reading ───────────────────────────────────
  {
    pattern: /^(ls|cat|head|tail|wc|file|stat|md5|md5sum|shasum|sha256sum)\s/,
    commands: [
      "ls",
      "cat",
      "head",
      "tail",
      "wc",
      "file",
      "stat",
      "md5",
      "md5sum",
      "shasum",
      "sha256sum",
    ],
    tier: "L0",
  },
  { pattern: /^(ls|pwd)$/, commands: ["ls", "pwd"], tier: "L0" },
  {
    pattern: /^(readlink|realpath|basename|dirname)\s/,
    commands: ["readlink", "realpath", "basename", "dirname"],
    tier: "L0",
  },
  {
    pattern: /^sed\s+-n\s+['"][0-9,\- $]+p['"]\s+.+$/,
    commands: ["sed -n"],
    tier: "L0",
  },

  // ── L0: Search ─────────────────────────────────────────────
  {
    pattern: /^(find|locate|mdfind)\s/,
    commands: ["find", "locate", "mdfind"],
    tier: "L0",
  },
  {
    pattern: /^(grep|egrep|fgrep|rg|ag|ack)\s/,
    commands: ["grep", "egrep", "fgrep", "rg", "ag", "ack"],
    tier: "L0",
  },
  { pattern: /^fd\s/, commands: ["fd"], tier: "L0" },

  // ── L0: Dir visualization ──────────────────────────────────
  { pattern: /^tree(\s|$)/, commands: ["tree"], tier: "L0" },

  // ── L0: File comparison ────────────────────────────────────
  {
    pattern: /^(diff|cmp|comm)\s/,
    commands: ["diff", "cmp", "comm"],
    tier: "L0",
  },

  // ── L0: Text processing (stdout only) ──────────────────────
  {
    pattern: /^(sort|uniq|tr|cut|paste|fold|column|nl|rev|tac|strings)\s/,
    commands: [
      "sort",
      "uniq",
      "tr",
      "cut",
      "paste",
      "fold",
      "column",
      "nl",
      "rev",
      "tac",
      "strings",
    ],
    tier: "L0",
  },

  // ── L0: Data processing (stdout only) ──────────────────────
  { pattern: /^(jq|yq)\s/, commands: ["jq", "yq"], tier: "L0" },

  // ── L0: System info (safe subset only) ─────────────────────
  {
    pattern: /^(pwd|whoami|hostname|uname|date|uptime|which|where|type)\b/,
    commands: [
      "pwd",
      "whoami",
      "hostname",
      "uname",
      "date",
      "uptime",
      "which",
      "where",
      "type",
    ],
    tier: "L0",
  },
  { pattern: /^(echo|printf)\s/, commands: ["echo", "printf"], tier: "L0" },
  { pattern: /^(df|du)\s/, commands: ["df", "du"], tier: "L0" },
  { pattern: /^(man|info)\s/, commands: ["man", "info"], tier: "L0" },

  // ── L0: Binary inspection ──────────────────────────────────
  {
    pattern: /^(xxd|hexdump|od)\s/,
    commands: ["xxd", "hexdump", "od"],
    tier: "L0",
  },

  // ── L0: Package listing (LOCAL-ONLY, no network) ───────────
  {
    pattern: /^npm\s+(list|ls)\b/,
    commands: ["npm list", "npm ls"],
    tier: "L0",
  },
  {
    pattern: /^pip3?\s+(list|show|freeze)\b/,
    commands: ["pip list", "pip show", "pip freeze"],
    tier: "L0",
  },
  { pattern: /^brew\s+list\b/, commands: ["brew list"], tier: "L0" },
  {
    pattern: /^cargo\s+(tree|metadata)\b/,
    commands: ["cargo tree", "cargo metadata"],
    tier: "L0",
  },
  { pattern: /^go\s+version\b/, commands: ["go version"], tier: "L0" },
  {
    pattern: /^go\s+env(?:\s+[A-Za-z_][A-Za-z0-9_]*)?$/,
    commands: ["go env"],
    tier: "L0",
  },

  // ── L1: Build / test / lint tools ──────────────────────────
  {
    pattern: /^deno\s+(test|task|fmt|lint|check|bench)\b/,
    commands: [
      "deno test",
      "deno task",
      "deno fmt",
      "deno lint",
      "deno check",
      "deno bench",
    ],
    tier: "L1",
  },
  {
    pattern: /^npm\s+(test|run|start)\b/,
    commands: ["npm test", "npm run", "npm start"],
    tier: "L1",
  },
  { pattern: /^npx\s/, commands: ["npx"], tier: "L1" },
  { pattern: /^node\s+--check\b/, commands: ["node --check"], tier: "L1" },
  {
    pattern: /^yarn\s+(test|run|start)\b/,
    commands: ["yarn test", "yarn run", "yarn start"],
    tier: "L1",
  },
  {
    pattern: /^pnpm\s+(test|run|start)\b/,
    commands: ["pnpm test", "pnpm run", "pnpm start"],
    tier: "L1",
  },
  { pattern: /^make(\s|$)/, commands: ["make"], tier: "L1" },
  {
    pattern: /^cargo\s+(test|build|check|clippy|fmt|bench|run)\b/,
    commands: [
      "cargo test",
      "cargo build",
      "cargo check",
      "cargo clippy",
      "cargo fmt",
      "cargo bench",
      "cargo run",
    ],
    tier: "L1",
  },
  {
    pattern: /^go\s+(test|build|vet|fmt|run)\b/,
    commands: ["go test", "go build", "go vet", "go fmt", "go run"],
    tier: "L1",
  },
  {
    pattern: /^python3?\s+(-m\s+)?(pytest|unittest|mypy|flake8|black|ruff)\b/,
    commands: ["python pytest", "python -m pytest", "python3 -m mypy"],
    tier: "L1",
  },
  {
    pattern: /^python3?\s+-m\s+py_compile\b/,
    commands: ["python -m py_compile"],
    tier: "L1",
  },
  {
    pattern: /^(pytest|mypy|eslint|prettier|tsc|biome)\b/,
    commands: ["pytest", "mypy", "eslint", "prettier", "tsc", "biome"],
    tier: "L1",
  },
] as const;

/**
 * Deny-list manifest — patterns that override an L0 match and bump to L2.
 * Catches destructive flags on otherwise-safe commands.
 */
const SHELL_DENY_MANIFEST: readonly ShellDenySpec[] = [
  { pattern: /^find\s.*\s-delete\b/, reason: "find -delete" },
  {
    pattern: /^find\s.*\s-(exec|execdir|ok|okdir)\b/,
    reason: "find -exec/-execdir/-ok/-okdir",
  },
  { pattern: /^find\s.*\s-exec\s+rm\b/, reason: "find -exec rm" },
  { pattern: /^sort\s+(.*\s)?-o\s/, reason: "sort -o (in-place output)" },
  { pattern: /^yq\s+(.*\s)?-i\b/, reason: "yq -i (in-place edit)" },
  { pattern: /^go\s+env\s+.*\s-w\b/, reason: "go env -w (write env var)" },
  { pattern: /^go\s+env\s+-w\b/, reason: "go env -w (write env var)" },
  {
    pattern: /^git\s+branch\s+(.*\s)?-[dD]\b/,
    reason: "git branch -d/-D (delete)",
  },
  {
    pattern: /^git\s+branch\s+(.*\s)?-[mMcC]\b/,
    reason: "git branch -m/-M/-c/-C (move/copy)",
  },
  {
    pattern: /^git\s+remote\s+(.*\s)?(add|remove|rm|rename)\b/,
    reason: "git remote add/remove/rename",
  },
  {
    pattern: /^git\s+remote\s+(.*\s)?(set-url|set-head|prune)\b/,
    reason: "git remote set-url/set-head/prune",
  },
  { pattern: /^git\s+tag\s+(.*\s)?-d\b/, reason: "git tag -d (delete)" },
  {
    pattern: /^git\s+tag\s+(.*\s)?-[af]\b/,
    reason: "git tag -a/-f (annotate/force)",
  },
  {
    pattern: /^git\s+config\s+(?!--?(get|list|l)\b)/,
    reason: "git config SET (not get/list)",
  },
] as const;

// ── Derived runtime arrays (DO NOT edit — generated from manifests above) ──

/** L0 shell commands — read-only, no side effects, auto-approved */
export const SHELL_ALLOWLIST_L0: readonly RegExp[] = SHELL_COMMAND_MANIFEST
  .filter((s) => s.tier === "L0").map((s) => s.pattern);

/** L1 shell commands — low risk, prompt once per session */
export const SHELL_ALLOWLIST_L1: readonly RegExp[] = SHELL_COMMAND_MANIFEST
  .filter((s) => s.tier === "L1").map((s) => s.pattern);

/** Deny patterns that override L0 — destructive flags on otherwise-safe commands */
export const SHELL_DENYLIST_L0: readonly RegExp[] = SHELL_DENY_MANIFEST.map(
  (s) => s.pattern,
);

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
  /** LLM call timeout (default: 900000ms = 15 minutes; local 8B models on slow CPU CI runners are genuinely slow) */
  llm: 900_000,

  /** Tool execution timeout (default: 60000ms = 60 seconds) */
  tool: 60000,

  /** User input/confirmation timeout (default: 300000ms = 5 minutes) */
  userInput: 300000,

  /** Total agent loop timeout (default: 2400000ms = 40 minutes) */
  total: 2_400_000,
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
 * Default maximum tool calls per turn
 *
 * Used by:
 * - orchestrator.ts: runReActLoop
 * - cli/ask.ts: default max-calls
 */
export const DEFAULT_MAX_TOOL_CALLS = 50;
export const RESPONSE_CONTINUATION_MAX_HOPS = 2;
export const CONTEXT_PRESSURE_SOFT_THRESHOLD = 0.75;

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

  /** Max model-facing tool observation bytes to add from one LLM tool batch */
  maxToolObservationBytesPerTurn: 24 * 1024,
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
  summaryMaxChars: 2400,
  summaryKeepRecent: 4,
  compactionThreshold: 0.9,
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
const FRONTIER_PROVIDER_PREFIXES = new Set([
  "anthropic",
  "openai",
  "google",
  "claude-code",
]);

/** Extract provider prefix from "provider/model" string */
export function extractProviderName(model?: string): string {
  if (!model) return "unknown";
  return extractProvider(model) ?? "ollama";
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
  return FRONTIER_PROVIDER_PREFIXES.has(prefix);
}

// ============================================================
// Grounding modes (orthogonal to capability class — retained as-is)
// ============================================================

const GROUNDING_MODES = ["off", "warn", "strict"] as const;
export type GroundingMode = typeof GROUNDING_MODES[number];

/** O(1) membership check for grounding mode validation */
const GROUNDING_MODES_SET: ReadonlySet<string> = new Set(GROUNDING_MODES);

export function isGroundingMode(value: unknown): value is GroundingMode {
  return typeof value === "string" && GROUNDING_MODES_SET.has(value);
}

/** Extract parameter count in billions from a string like "8B" or "70.6B". */
export function parseParamBillions(
  parameterSize?: string,
): number | undefined {
  if (!parameterSize) return undefined;
  const match = parameterSize.match(/^(\d+(?:\.\d+)?)\s*[bB]/);
  return match ? parseFloat(match[1]) : undefined;
}

/**
 * Returns true if this model is classified as agent-capable.
 *
 * Phase 1 routing: equivalent to `classifyModelCapability(...) === "agent"`.
 * Callers use this as the admission gate for agent mode (multi-step
 * autonomous tool loops). Cloud frontier models and curated local
 * models (AGENT_CAPABLE_MODELS) pass. Tool-capable-but-unproven local
 * models (e.g. gemma*, phi*, small variants) now fail this gate
 * intentionally — see memory: project_agent_system_default_broken.md.
 */
export function supportsAgentExecution(
  model?: string,
  modelInfo?: {
    parameterSize?: string;
    contextWindow?: number;
    capabilities?: string[];
  } | null,
): boolean {
  return classifyModelCapability(modelInfo, model) === "agent";
}

// ============================================================
// Tool Result Limits
// ============================================================

/**
 * Limits for tool result processing.
 *
 * Used by:
 * - orchestrator-tool-formatting.ts: failure payload detection
 * - orchestrator-response.ts: passage index cap
 */
export const TOOL_RESULT_LIMITS = {
  /** Max bytes for a tool result to be checked for failure-as-data pattern */
  failurePayloadMaxBytes: 500,
  /** Max citation source index entries kept in sliding window */
  maxPassageIndexEntries: 300,
  /** Max tool uses retained for grounding checks (sliding window) */
  maxToolUsesForGrounding: 50,
} as const;

/** Default tool denylist for interactive ask mode */
export const DEFAULT_TOOL_DENYLIST = [
  "complete_task",
] as const;

// ============================================================
// REPL Main-Thread Eager Tool Core
// ============================================================

/**
 * Eager tool surface for the REPL main-thread query path.
 *
 * The REPL has different UX constraints than agent mode (`hlvm ask`):
 * users type tool names directly and expect autocomplete to work. Shrinking
 * the eager list would break the "type `pw_goto(...)` in the REPL" habit.
 *
 * Agent mode uses the narrower AGENT_CLASS_STARTER_TOOLS via starterPolicy.
 * This constant is ONLY for REPL main-thread seeding.
 */
export const REPL_MAIN_THREAD_EAGER_TOOLS: readonly string[] = [
  "ask_user",
  "tool_search",
  AGENT_TOOL_NAME,
  "todo_read",
  "todo_write",
  "list_files",
  "read_file",
  "move_to_trash",
  "reveal_path",
  "file_metadata",
  "make_directory",
  "move_path",
  "copy_path",
  "search_code",
  "find_symbol",
  "get_structure",
  "edit_file",
  "write_file",
  "git_status",
  "git_diff",
  "git_log",
  "shell_exec",
  "shell_script",
  "open_path",
  // Browser tools — eager so REPL users can call them by name directly.
  // pw_* fail gracefully if Chromium not installed.
  // ch_* fail gracefully if Chrome extension not connected.
  "pw_goto",
  "pw_click",
  "pw_fill",
  "pw_content",
  "pw_snapshot",
  "pw_screenshot",
  "ch_navigate",
  "ch_back",
  "ch_tabs",
  "ch_tab_create",
  "ch_tab_close",
  "ch_tab_select",
  "ch_click",
  "ch_fill",
  "ch_type",
  "ch_hover",
  "ch_scroll",
  "ch_select_option",
  "ch_content",
  "ch_links",
  "ch_evaluate",
  "ch_screenshot",
  "ch_find",
  "ch_resize_window",
  "ch_wait_for",
  "ch_enable_monitoring",
  "ch_console",
  "ch_network",
] as const;

// ============================================================
// Model Capability Class (Phase 1 routing)
// ============================================================

/**
 * Model capability class — what kind of work can this model reliably do?
 *
 * chat:  Text only. No tool calls. Direct chat mode.
 * tool:  Can emit tool calls, but not trusted to drive multi-step
 *        ReAct loops unattended. One-shot tool use only.
 * agent: Tool-capable AND on the curated allowlist — known to drive
 *        autonomous loops reliably (frontier cloud + known-good local).
 *
 * Ordering: chat < tool < agent. Each class is a superset of the previous.
 */
export type ModelCapabilityClass = "chat" | "tool" | "agent";

/** Returns true if `value` meets or exceeds `minimum` class. */
export function capabilityAtLeast(
  value: ModelCapabilityClass,
  minimum: ModelCapabilityClass,
): boolean {
  const order: Record<ModelCapabilityClass, number> = {
    chat: 0,
    tool: 1,
    agent: 2,
  };
  return order[value] >= order[minimum];
}

/**
 * Local models curated as agent-capable.
 *
 * Criteria:
 *   - Reliably drives ReAct loops (multi-turn tool calls with correct JSON).
 *   - Reports "tools" capability in /api/show.
 *   - Parameter count >= 7B (empirical floor for loop coherence).
 *
 * Patterns match the post-provider-prefix portion of the model name
 * (e.g. "ollama/qwen3:8b" is matched against "qwen3:8b").
 *
 * Internal — consumers use classifyModelCapability() instead.
 */
const AGENT_CAPABLE_MODELS: readonly RegExp[] = [
  /^qwen3($|[:\-])/i,
  /^qwen2\.5:(7|14|32|72)b/i,
  /^qwen2\.5-coder:(7|14|32)b/i,
  /^llama3\.(1|2|3):(8|70|405)b/i,
  /^deepseek-(coder|r1|v[0-9]+)/i,
  /^mistral(-|:)(large|small|medium|nemo)/i,
  /^mixtral:(8x7b|8x22b)/i,
  /^command-r(-plus)?/i,
  /^yi:(9|34)b/i,
];

/**
 * True if model name matches the curated agent-capable local allowlist
 * AND (if modelInfo provided) reports >= 7B parameters. Double-gate:
 * a mis-tagged model size overrides a pattern match.
 */
function isAgentCapableLocalModel(
  modelName: string,
  modelInfo?: { parameterSize?: string } | null,
): boolean {
  const suffix = extractModelSuffix(modelName);
  if (!AGENT_CAPABLE_MODELS.some((re) => re.test(suffix))) return false;
  const billions = parseParamBillions(modelInfo?.parameterSize);
  return billions === undefined || billions >= 7;
}

/**
 * Classify a model into chat / tool / agent capability class.
 *
 * Priority order (most specific signal first):
 *   1. capabilities reported + "tools" absent → chat
 *   2. parameter count < 3B                    → chat
 *   3. context window < 8K                     → chat
 *   4. frontier provider                       → agent
 *   5. local model on curated allowlist + ≥7B  → agent
 *   6. default                                 → tool
 *      (has "tools" capability but unproven, OR unknown — safe: allows
 *      one-shot tool use but blocks autonomous agent loops)
 */
export function classifyModelCapability(
  modelInfo?: {
    parameterSize?: string;
    contextWindow?: number;
    capabilities?: string[];
  } | null,
  model?: string,
): ModelCapabilityClass {
  const caps = modelInfo?.capabilities;
  if (caps?.length && !caps.includes("tools")) return "chat";

  const billions = parseParamBillions(modelInfo?.parameterSize);
  if (billions !== undefined && billions < 3) return "chat";
  if (modelInfo?.contextWindow && modelInfo.contextWindow < 8_000) {
    return "chat";
  }

  if (isFrontierProvider(model)) return "agent";
  if (model && isAgentCapableLocalModel(model, modelInfo)) return "agent";

  return "tool";
}

// ============================================================
// Capability-Class Starter Tool Lists
// ============================================================

/**
 * Starter tools for the `tool` capability class.
 *
 * Evidence: tool-selection accuracy collapses past ~30 tools (RAG-MCP,
 * arXiv 2505.03275). This ~17-tool set covers high-frequency cases;
 * anything else is discoverable via tool_search (agent class only).
 */
export const TOOL_CLASS_STARTER_TOOLS: readonly string[] = [
  "read_file",
  "write_file",
  "edit_file",
  "list_files",
  "search_code",
  "find_symbol",
  "git_status",
  "git_diff",
  "git_log",
  "search_web",
  "web_fetch",
  "fetch_url",
  "memory_write",
  "memory_search",
  "memory_edit",
  "ask_user",
  "complete_task",
  "shell_exec",
] as const;

/**
 * Starter tools for the `agent` capability class.
 * Same as tool class + `tool_search` for on-demand discovery.
 */
export const AGENT_CLASS_STARTER_TOOLS: readonly string[] = [
  ...TOOL_CLASS_STARTER_TOOLS,
  "tool_search",
] as const;

/** SSOT: capability class → starter tool list. */
const STARTER_TOOLS_BY_CLASS: Record<
  ModelCapabilityClass,
  readonly string[]
> = {
  chat: [],
  tool: TOOL_CLASS_STARTER_TOOLS,
  agent: AGENT_CLASS_STARTER_TOOLS,
};

/**
 * Compute the starter tool filter for a capability class.
 *
 * Single starter allowlist per class (no size/context variation) —
 * only by capability class. Runtime-phase narrowing stays in
 * applyAdaptiveToolPhase (orchestrator.ts).
 *
 * User-explicit allowlist wins over class default.
 */
export function starterPolicy(
  capClass: ModelCapabilityClass,
  userAllowlist?: string[],
  userDenylist?: string[],
): { allowlist?: string[]; denylist?: string[] } {
  return {
    allowlist: userAllowlist !== undefined
      ? userAllowlist
      : [...STARTER_TOOLS_BY_CLASS[capClass]],
    denylist: userDenylist,
  };
}

// ============================================================
// CLI Exit Codes (SSOT)
// ============================================================

/**
 * Standard exit codes for CLI commands (particularly `hlvm ask`).
 *
 * Following Unix conventions and industry standards:
 * - 0: Success
 * - 1: General failure (query failed, LLM error, validation error)
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_FAILURE: 1,
} as const;
