/**
 * Tool Registry - Central registry for all AI agent tools
 *
 * Provides unified access to all tool collections:
 * - File tools (read_file, write_file, list_files, edit_file)
 * - Code tools (search_code, find_symbol, get_structure)
 * - Shell tools (shell_exec, shell_script)
 *
 * Features:
 * - Type-safe tool lookup
 * - Argument validation
 * - Metadata access (description, args, safety level)
 * - SSOT-compliant (all tools use platform abstraction)
 */

import { FILE_TOOLS } from "./tools/file-tools.ts";
import { CODE_TOOLS } from "./tools/code-tools.ts";
import { SHELL_TOOLS } from "./tools/shell-tools.ts";
import { META_TOOLS } from "./tools/meta-tools.ts";
import { WEB_TOOLS } from "./tools/web-tools.ts";
import { MEMORY_TOOLS } from "../memory/mod.ts";
import { DATA_TOOLS } from "./tools/data-tools.ts";
import { GIT_TOOLS } from "./tools/git-tools.ts";
import { DELEGATE_TOOLS } from "./tools/delegate-tools.ts";
import { TEAM_TOOLS } from "./tools/team-tools.ts";
import { ValidationError } from "../../common/error.ts";
import { safeStringify } from "../../common/safe-stringify.ts";
import type { AgentPolicy } from "./policy.ts";
import { isToolArgsObject } from "./validation.ts";
import type { TodoState } from "./todo-state.ts";
import type { CheckpointRecorder } from "./checkpoints.ts";
import type { ModelTier } from "./constants.ts";
import type { TeamRuntime } from "./team-runtime.ts";
import {
  buildToolJsonSchema,
  coerceArgsToSchema,
  normalizeArgsForTool,
  validateArgsAgainstSchema,
  validateToolSchema,
} from "./tool-schema.ts";
import { getAgentLogger } from "./logger.ts";

// ============================================================
// Types
// ============================================================

/** Response from GUI/CLI to an interaction request */
export interface InteractionResponse {
  approved: boolean;
  rememberChoice?: boolean;
  userInput?: string;
}

/** Interaction request event emitted to GUI/CLI */
export interface InteractionRequestEvent {
  type: "interaction_request";
  requestId: string;
  mode: "permission" | "question";
  toolName?: string;
  toolArgs?: string;
  question?: string;
  /** Optional JSON Schema for MCP elicitation form inputs */
  schema?: Record<string, unknown>;
}

/** Optional execution options passed to tools (e.g., cancellation signal) */
export interface ToolExecutionOptions {
  signal?: AbortSignal;
  /** Active session model id for tool-internal AI calls. */
  modelId?: string;
  /** Active session model tier for tool-internal routing. */
  modelTier?: ModelTier;
  policy?: AgentPolicy | null;
  onInteraction?: (
    event: InteractionRequestEvent,
  ) => Promise<InteractionResponse>;
  /** Session-scoped tool owner (used by dynamic tool families like MCP). */
  toolOwnerId?: string;
  /** Top-level delegate owner used to scope background agent control tools. */
  delegateOwnerId?: string;
  /** Optional lazy MCP loader hook used by tool_search. */
  ensureMcpLoaded?: () => Promise<void>;
  /** Session-scoped todo state used by todo_read/todo_write. */
  todoState?: TodoState;
  /** Session-scoped automatic checkpoint recorder for supported file mutations. */
  checkpointRecorder?: CheckpointRecorder;
  /** Optional registry-backed tool search callback used by tool_search. */
  searchTools?: (
    query: string,
    options?: {
      allowlist?: string[];
      denylist?: string[];
      ownerId?: string;
      limit?: number;
    },
  ) => ToolSearchResult[];
  /** Shared team runtime for system-managed collaboration. */
  teamRuntime?: TeamRuntime;
  /** Current team member ID for the active agent turn. */
  teamMemberId?: string;
  /** Lead member ID for the current team runtime. */
  teamLeadMemberId?: string;
}

/** Generic tool function signature */
export type ToolFunction = (
  args: unknown,
  workspace: string,
  options?: ToolExecutionOptions,
) => Promise<unknown>;

/** Tool metadata with function and documentation */
export interface FormattedToolResult {
  summaryDisplay?: string;
  returnDisplay: string;
  llmContent?: string;
}

export interface ToolMetadata {
  fn: ToolFunction;
  description: string;
  args: Record<string, string>;
  /** Optional arg alias map applied before coercion/validation. */
  argAliases?: Record<string, string>;
  returns?: Record<string, string>;
  safetyLevel?: "L0" | "L1" | "L2";
  safety?: string; // Additional safety info
  /** Tool category for auto-generated routing table */
  category?:
    | "read"
    | "write"
    | "search"
    | "shell"
    | "git"
    | "web"
    | "data"
    | "meta"
    | "memory";
  /** Shell command(s) this tool replaces (e.g., "cat/head/tail") — drives routing rules */
  replaces?: string;
  /** Skip argument validation (used for dynamic tools with unknown schemas) */
  skipValidation?: boolean;
  /** Optional formatter for tool results (for display/LLM output) */
  formatResult?: (result: unknown) => FormattedToolResult | null;
  /**
   * If true, a successful standalone call can end the turn immediately using
   * the formatted tool result as the final user-facing response.
   */
  terminalOnSuccess?: boolean;
}

/** Condensed tool summary used by the tool_search meta tool. */
export interface ToolSearchResult {
  name: string;
  description: string;
  category?: ToolMetadata["category"];
  safetyLevel: "L0" | "L1" | "L2";
  source: "built-in" | "dynamic";
}

function formatDelegateAgentResult(
  result: unknown,
): FormattedToolResult | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  const delegatedResult = record.result;
  const summaryDisplay = typeof delegatedResult === "string" &&
      delegatedResult.trim()
    ? delegatedResult.trim().split("\n").map((line) => line.trim()).find(
      Boolean,
    ) ??
      "Delegation complete."
    : "Delegation complete.";
  return {
    summaryDisplay,
    returnDisplay: safeStringify(result, 2),
    llmContent: typeof delegatedResult === "string" && delegatedResult.trim()
      ? delegatedResult.trim()
      : undefined,
  };
}

/** Result of argument validation */
interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/** Result of preparing tool args for execution (coercion + validation). */
export interface ToolArgsPreparationResult {
  coercedArgs: unknown;
  validation: ValidationResult;
}

// ============================================================
// Tool Registry
// ============================================================

/**
 * Central registry combining all tool collections
 *
 * Tools are organized by category:
 * - File tools: Direct file system operations
 * - Code tools: Code search and analysis
 * - Shell tools: Shell command execution
 * - Data tools: Generic aggregation/filtering/transformation
 */
export const TOOL_REGISTRY: Record<string, ToolMetadata> = {
  ...FILE_TOOLS,
  ...CODE_TOOLS,
  ...SHELL_TOOLS,
  ...META_TOOLS,
  ...WEB_TOOLS,
  ...MEMORY_TOOLS,
  delegate_agent: {
    fn: () =>
      Promise.reject(
        new ValidationError(
          "delegate_agent is not configured. Ensure the session provides a delegate handler.",
          "delegate_agent",
        ),
      ),
    description: "Delegate a task to a specialist agent and return its result.",
    category: "meta",
    args: {
      agent: "string - Agent name (general, code, file, shell, web, memory)",
      task: "string - Task to delegate",
      maxToolCalls: "number (optional) - Max tool calls for the delegate",
      groundingMode: "string (optional) - off|warn|strict",
      background:
        "boolean (optional) - Run in background with isolated workspace and threadId. Foreground delegates stay read-only in the parent workspace.",
      fork_with_history:
        "boolean (optional) - Seed child with parent conversation context (default: false)",
    },
    returns: {
      agent: "string",
      result: "string",
      stats: "object",
    },
    safetyLevel: "L0",
    safety: "Internal delegation (auto-approved).",
    formatResult: formatDelegateAgentResult,
  },
  batch_delegate: {
    fn: () =>
      Promise.reject(
        new ValidationError(
          "batch_delegate is not configured. Ensure the session provides a delegate handler.",
          "batch_delegate",
        ),
      ),
    description:
      "Fan-out delegation: spawn multiple background agents from a data array with template substitution.",
    category: "meta",
    args: {
      agent: "string - Agent profile name",
      task_template: "string - Task template with {{column}} placeholders",
      data:
        "array|string - Array of row objects or CSV text for template substitution",
      csv_path: "string (optional) - Workspace-relative CSV file path",
      max_concurrency: "number (optional) - Max concurrent agents",
    },
    returns: {
      batchId: "string",
      totalRows: "number",
      spawned: "number",
      threadIds: "array",
      status: "string",
    },
    skipValidation: true,
    safetyLevel: "L0",
    safety: "Internal delegation (auto-approved).",
  },
  ...DATA_TOOLS,
  ...GIT_TOOLS,
  ...DELEGATE_TOOLS,
  ...TEAM_TOOLS,
} as Record<string, ToolMetadata>;

/**
 * Dynamic registry for external tools (e.g., MCP)
 *
 * Stored separately to avoid mutating static registry.
 */
interface DynamicToolEntry {
  fallbackTool: ToolMetadata | null;
  scopedTools: Map<string, ToolMetadata>;
}
const DYNAMIC_TOOL_REGISTRY = new Map<string, DynamicToolEntry>();

/** Cached merged view of TOOL_REGISTRY + DYNAMIC_TOOL_REGISTRY */
let _allToolsCache: Record<string, ToolMetadata> | null = null;
/** Per-ownerId cache for getAllTools() */
const _ownerToolsCache = new Map<string, Record<string, ToolMetadata>>();
/** Pre-computed normalized name map: lowercased stripped name → canonical name */
let _normalizedNameMap: Map<string, string> | null = null;
/** Cached tool count */
let _toolCount: number | null = null;
/** Pre-computed word sets per tool name for suggestToolNames() */
let _toolWordSets: Map<string, { stripped: string; words: string[] }> | null =
  null;
/** Monotonic generation counter — incremented on every cache invalidation */
let _registryGeneration = 0;

/** Current registry generation (monotonic counter, incremented on tool changes) */
export function getToolRegistryGeneration(): number {
  return _registryGeneration;
}

function invalidateAllToolsCache(): void {
  _allToolsCache = null;
  _ownerToolsCache.clear();
  _normalizedNameMap = null;
  _toolCount = null;
  _toolWordSets = null;
  _registryGeneration++;
}

function getActiveDynamicTool(
  name: string,
  ownerId?: string,
): ToolMetadata | undefined {
  const entry = DYNAMIC_TOOL_REGISTRY.get(name);
  if (!entry) return undefined;
  if (ownerId) {
    return entry.scopedTools.get(ownerId) ?? entry.fallbackTool ?? undefined;
  }
  const firstScoped = entry.scopedTools.values().next().value as
    | ToolMetadata
    | undefined;
  return firstScoped ?? entry.fallbackTool ?? undefined;
}

function getDynamicToolNames(ownerId?: string): string[] {
  if (!ownerId) return [...DYNAMIC_TOOL_REGISTRY.keys()];
  const names: string[] = [];
  for (const [name, entry] of DYNAMIC_TOOL_REGISTRY.entries()) {
    if (entry.scopedTools.has(ownerId) || entry.fallbackTool) {
      names.push(name);
    }
  }
  return names;
}

function getDynamicToolsSnapshot(
  ownerId?: string,
): Record<string, ToolMetadata> {
  const out: Record<string, ToolMetadata> = {};
  for (const name of getDynamicToolNames(ownerId)) {
    const tool = getActiveDynamicTool(name, ownerId);
    if (tool) out[name] = tool;
  }
  return out;
}

function buildNameNormalizationMap(toolNames: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const name of toolNames) {
    const lower = name.toLowerCase();
    map.set(lower, name);
    const stripped = lower.replace(/[-_ ]/g, "");
    if (!map.has(stripped)) {
      map.set(stripped, name);
    }
    const camelToSnake = name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    if (camelToSnake !== lower && !map.has(camelToSnake)) {
      map.set(camelToSnake, name);
    }
  }
  return map;
}

function getNormalizedNameMap(ownerId?: string): Map<string, string> {
  if (ownerId) {
    return buildNameNormalizationMap(Object.keys(getAllTools(ownerId)));
  }
  if (!_normalizedNameMap) {
    _normalizedNameMap = buildNameNormalizationMap(Object.keys(getAllTools()));
  }
  return _normalizedNameMap;
}

function buildToolWordSetMap(
  toolNames: string[],
): Map<string, { stripped: string; words: string[] }> {
  const map = new Map<string, { stripped: string; words: string[] }>();
  for (const name of toolNames) {
    map.set(name, {
      stripped: name.replace(/[-_ ]/g, ""),
      words: name.split(/[-_ ]/),
    });
  }
  return map;
}

function getToolWordSets(
  ownerId?: string,
): Map<string, { stripped: string; words: string[] }> {
  if (ownerId) {
    return buildToolWordSetMap(Object.keys(getAllTools(ownerId)));
  }
  if (!_toolWordSets) {
    _toolWordSets = buildToolWordSetMap(Object.keys(getAllTools()));
  }
  return _toolWordSets;
}

// ============================================================
// Registry API
// ============================================================

/**
 * Get tool by name
 *
 * @param name Tool name (e.g., "read_file", "search_code")
 * @returns Tool metadata with function and documentation
 * @throws Error if tool not found
 *
 * @example
 * ```ts
 * const tool = getTool("read_file");
 * const result = await tool.fn({ path: "src/main.ts" }, "/workspace");
 * ```
 */
export function getTool(name: string, ownerId?: string): ToolMetadata {
  const tool = getActiveDynamicTool(name, ownerId) ?? TOOL_REGISTRY[name];

  if (!tool) {
    const available = Object.keys(getAllTools(ownerId)).join(", ");
    throw new ValidationError(
      `Tool '${name}' not found. Available tools: ${available}`,
      "tool_registry",
    );
  }

  return tool;
}

/**
 * Get all registered tools
 *
 * @returns Record of all tools with metadata
 *
 * @example
 * ```ts
 * const tools = getAllTools();
 * for (const [name, metadata] of Object.entries(tools)) {
 *   console.log(`${name}: ${metadata.description}`);
 * }
 * ```
 */
export function getAllTools(ownerId?: string): Record<string, ToolMetadata> {
  if (ownerId) {
    let cached = _ownerToolsCache.get(ownerId);
    if (!cached) {
      cached = { ...TOOL_REGISTRY, ...getDynamicToolsSnapshot(ownerId) };
      _ownerToolsCache.set(ownerId, cached);
    }
    return cached;
  }
  if (!_allToolsCache) {
    _allToolsCache = { ...TOOL_REGISTRY, ...getDynamicToolsSnapshot() };
  }
  return _allToolsCache;
}

/**
 * Resolve tools with optional allow/deny filtering.
 */
export function resolveTools(
  options?: { allowlist?: string[]; denylist?: string[]; ownerId?: string },
): Record<string, ToolMetadata> {
  const tools = getAllTools(options?.ownerId);
  const allowlist = options?.allowlist?.filter((name) => name in tools) ?? [];
  const denylist = options?.denylist?.filter((name) => name in tools) ?? [];
  if (allowlist.length === 0 && denylist.length === 0) {
    return tools;
  }

  const selected: Record<string, ToolMetadata> = allowlist.length > 0
    ? Object.fromEntries(
      allowlist.map((name) => [name, tools[name]]),
    )
    : { ...tools };

  if (denylist.length > 0) {
    const denySet = new Set(denylist);
    for (const name of Object.keys(selected)) {
      if (denySet.has(name)) {
        delete selected[name];
      }
    }
  }

  return selected;
}

/**
 * Search tools by natural-language query across name/description/argument keys.
 * Returns ranked summaries suitable for LLM-facing discovery.
 */
export function searchTools(
  query: string,
  options?: {
    allowlist?: string[];
    denylist?: string[];
    ownerId?: string;
    limit?: number;
  },
): ToolSearchResult[] {
  const tools = resolveTools({
    allowlist: options?.allowlist,
    denylist: options?.denylist,
    ownerId: options?.ownerId,
  });
  const normalizedQuery = query.trim().toLowerCase();
  const tokens = normalizedQuery.length > 0
    ? normalizedQuery.split(/\s+/).filter((t) => t.length > 0)
    : [];
  const requestedLimit = options?.limit ?? 12;
  const limit = Math.max(1, Math.min(requestedLimit, 50));

  const scored: Array<ToolSearchResult & { score: number }> = [];
  for (const [name, meta] of Object.entries(tools)) {
    const lowerName = name.toLowerCase();
    const lowerDescription = meta.description.toLowerCase();
    const argKeys = Object.keys(meta.args).join(" ").toLowerCase();
    const haystack = `${lowerName} ${lowerDescription} ${argKeys}`;

    let score = normalizedQuery.length === 0 ? 1 : 0;
    if (normalizedQuery.length > 0) {
      if (lowerName === normalizedQuery) score += 12;
      if (lowerName.startsWith(normalizedQuery)) score += 8;
      if (lowerName.includes(normalizedQuery)) score += 5;

      for (const token of tokens) {
        if (lowerName.includes(token)) {
          score += 4;
        } else if (lowerDescription.includes(token)) {
          score += 2;
        } else if (argKeys.includes(token)) {
          score += 1;
        }
      }

      if (
        tokens.length > 0 && tokens.every((token) => haystack.includes(token))
      ) {
        score += 3;
      }
    }

    if (score <= 0) continue;
    scored.push({
      name,
      description: meta.description,
      category: meta.category,
      safetyLevel: meta.safetyLevel ?? "L0",
      source: name in TOOL_REGISTRY ? "built-in" : "dynamic",
      score,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });

  return scored.slice(0, limit).map(({ score: _score, ...tool }) => tool);
}

/**
 * Get tool names by category
 *
 * @returns Categorized tool names
 */
export function getToolsByCategory(): {
  file: string[];
  code: string[];
  shell: string[];
  meta: string[];
  web: string[];
  memory: string[];
  agent: string[];
  data: string[];
  git: string[];
  dynamic: string[];
} {
  return {
    file: Object.keys(FILE_TOOLS),
    code: Object.keys(CODE_TOOLS),
    shell: Object.keys(SHELL_TOOLS),
    meta: Object.keys(META_TOOLS),
    web: Object.keys(WEB_TOOLS),
    memory: Object.keys(MEMORY_TOOLS),
    agent: [
      "delegate_agent",
      "batch_delegate",
      ...Object.keys(DELEGATE_TOOLS),
      ...Object.keys(TEAM_TOOLS),
    ],
    data: Object.keys(DATA_TOOLS),
    git: Object.keys(GIT_TOOLS),
    dynamic: getDynamicToolNames(),
  };
}

/**
 * Check if tool exists
 *
 * @param name Tool name to check
 * @returns True if tool exists in registry
 *
 * @example
 * ```ts
 * if (hasTool("read_file")) {
 *   const tool = getTool("read_file");
 * }
 * ```
 */
export function hasTool(name: string, ownerId?: string): boolean {
  return name in TOOL_REGISTRY ||
    getActiveDynamicTool(name, ownerId) !== undefined;
}

/**
 * Attempt to normalize a tool name to a known tool name.
 *
 * Tries these transformations in order:
 * 1. Exact match (identity)
 * 2. Lowercase: "List_Files" → "list_files"
 * 3. camelCase to snake_case: "listFiles" → "list_files"
 * 4. Strip separators and fuzzy match: "list-files" → "list_files"
 *
 * @param name Tool name to normalize
 * @returns Normalized tool name if found, or null
 */
export function normalizeToolName(
  name: string,
  ownerId?: string,
): string | null {
  if (hasTool(name, ownerId)) return name;

  const map = getNormalizedNameMap(ownerId);
  const lower = name.toLowerCase();

  // Try lowercase
  const byLower = map.get(lower);
  if (byLower) return byLower;

  // Try camelCase → snake_case (apply regex BEFORE lowercasing)
  const snaked = name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  const bySnaked = map.get(snaked);
  if (bySnaked) return bySnaked;

  // Strip all separators and look up
  const stripped = lower.replace(/[-_ ]/g, "");
  const byStripped = map.get(stripped);
  if (byStripped) return byStripped;

  return null;
}

/**
 * Suggest similar tool names for an unknown tool.
 *
 * @param name Unknown tool name
 * @returns Array of up to 3 similar tool names
 */
export function suggestToolNames(name: string, ownerId?: string): string[] {
  const wordSets = getToolWordSets(ownerId);
  const lower = name.toLowerCase();
  const stripped = lower.replace(/[-_ ]/g, "");
  const nameWordSet = new Set(lower.split(/[-_ ]/));

  const scored: { name: string; score: number }[] = [];
  for (const [toolName, cached] of wordSets) {
    let score = 0;
    if (
      cached.stripped.startsWith(stripped) ||
      stripped.startsWith(cached.stripped)
    ) {
      score += 3;
    }
    if (
      cached.stripped.includes(stripped) || stripped.includes(cached.stripped)
    ) {
      score += 2;
    }
    for (const w of cached.words) {
      if (nameWordSet.has(w)) score++;
    }
    if (score > 0) scored.push({ name: toolName, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((s) => s.name);
}

/**
 * Validate tool arguments (basic type checking)
 *
 * Performs simple validation:
 * - Arguments must be an object
 * - Required argument names are present
 *
 * Note: Does not validate argument types or values deeply.
 * Full validation happens at tool execution time.
 *
 * @param name Tool name
 * @param args Arguments to validate
 * @returns Validation result with errors if invalid
 *
 * @example
 * ```ts
 * const result = validateToolArgs("read_file", { path: "src/main.ts" });
 * if (!result.valid) {
 *   console.error("Validation errors:", result.errors);
 * }
 * ```
 */
export function validateToolArgs(
  name: string,
  args: unknown,
  ownerId?: string,
): ValidationResult {
  const tool = getTool(name, ownerId);
  if (tool.skipValidation) {
    return { valid: true };
  }
  if (!isToolArgsObject(args)) {
    return { valid: false, errors: ["Arguments must be a plain object"] };
  }

  const schema = buildToolJsonSchema(tool);
  const normalizedArgs = normalizeArgsForTool(args, tool);
  const errors = validateArgsAgainstSchema(normalizedArgs, schema);

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Prepare tool arguments for execution by coercing first, then validating.
 *
 * This mirrors execution-time behavior used by the orchestrator while reusing
 * the same schema instance for both steps.
 */
export function prepareToolArgsForExecution(
  name: string,
  args: unknown,
  ownerId?: string,
): ToolArgsPreparationResult {
  const tool = getTool(name, ownerId);
  if (tool.skipValidation) {
    return {
      coercedArgs: args,
      validation: { valid: true },
    };
  }

  if (!isToolArgsObject(args)) {
    return {
      coercedArgs: args,
      validation: {
        valid: false,
        errors: ["Arguments must be a plain object"],
      },
    };
  }

  const schema = buildToolJsonSchema(tool);
  const normalizedArgs = normalizeArgsForTool(args, tool);
  const coercedArgs = coerceArgsToSchema(normalizedArgs, schema);
  const errors = validateArgsAgainstSchema(coercedArgs, schema);
  return {
    coercedArgs,
    validation: {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    },
  };
}

/**
 * Get tool count
 *
 * @returns Total number of registered tools
 */
export function getToolCount(ownerId?: string): number {
  if (ownerId) {
    return Object.keys(getAllTools(ownerId)).length;
  }
  if (_toolCount === null) {
    _toolCount = Object.keys(getAllTools()).length;
  }
  return _toolCount;
}

/**
 * Get tool description
 *
 * @param name Tool name
 * @returns Human-readable description
 * @throws Error if tool not found
 */
export function getToolDescription(name: string, ownerId?: string): string {
  const tool = getTool(name, ownerId);
  return tool.description;
}

/**
 * Get tool argument schema
 *
 * @param name Tool name
 * @returns Argument names and descriptions
 * @throws Error if tool not found
 */
export function getToolArgSchema(
  name: string,
  ownerId?: string,
): Record<string, string> {
  const tool = getTool(name, ownerId);
  return { ...tool.args };
}

// ============================================================
// Dynamic Tool Registration (e.g., MCP)
// ============================================================

/** Valid tool name pattern — cross-provider safe (OpenAI/Anthropic: max 64 chars) */
const VALID_TOOL_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

/**
 * Register a dynamic tool by name.
 *
 * Throws if the tool name is invalid or collides with a built-in tool.
 */
export function registerTool(name: string, tool: ToolMetadata): void {
  // Fix 18: Validate tool name format
  if (!VALID_TOOL_NAME.test(name)) {
    throw new ValidationError(
      `Invalid tool name '${name}': must match ${VALID_TOOL_NAME}`,
      "tool_registry",
    );
  }
  if (name in TOOL_REGISTRY) {
    throw new ValidationError(
      `Tool '${name}' already exists in built-in registry`,
      "tool_registry",
    );
  }
  const warnings = validateToolSchema(name, tool);
  for (const w of warnings) getAgentLogger().warn(w);
  const entry = DYNAMIC_TOOL_REGISTRY.get(name);
  if (entry?.fallbackTool) {
    throw new ValidationError(
      `Tool '${name}' already exists in dynamic registry`,
      "tool_registry",
    );
  }
  if (entry) {
    entry.fallbackTool = tool;
  } else {
    DYNAMIC_TOOL_REGISTRY.set(name, {
      fallbackTool: tool,
      scopedTools: new Map(),
    });
  }
  invalidateAllToolsCache();
}

/**
 * Register multiple dynamic tools.
 *
 * Returns the list of registered tool names.
 */
export function registerTools(
  tools: Record<string, ToolMetadata>,
  ownerId?: string,
): string[] {
  const registered: string[] = [];
  for (const [name, tool] of Object.entries(tools)) {
    if (!ownerId) {
      registerTool(name, tool);
      registered.push(name);
      continue;
    }
    if (!VALID_TOOL_NAME.test(name)) {
      throw new ValidationError(
        `Invalid tool name '${name}': must match ${VALID_TOOL_NAME}`,
        "tool_registry",
      );
    }
    if (name in TOOL_REGISTRY) {
      throw new ValidationError(
        `Tool '${name}' already exists in built-in registry`,
        "tool_registry",
      );
    }
    const warnings = validateToolSchema(name, tool);
    for (const w of warnings) getAgentLogger().warn(w);
    const entry = DYNAMIC_TOOL_REGISTRY.get(name);
    if (!entry) {
      DYNAMIC_TOOL_REGISTRY.set(name, {
        fallbackTool: null,
        scopedTools: new Map([[ownerId, tool]]),
      });
    } else {
      entry.scopedTools.set(ownerId, tool);
    }
    registered.push(name);
  }
  if (registered.length > 0) {
    invalidateAllToolsCache();
  }
  return registered;
}

/**
 * Unregister a dynamic tool by name.
 */
export function unregisterTool(name: string, ownerId?: string): void {
  if (!ownerId) {
    DYNAMIC_TOOL_REGISTRY.delete(name);
    invalidateAllToolsCache();
    return;
  }
  const entry = DYNAMIC_TOOL_REGISTRY.get(name);
  if (!entry) return;
  entry.scopedTools.delete(ownerId);
  if (!entry.fallbackTool && entry.scopedTools.size === 0) {
    DYNAMIC_TOOL_REGISTRY.delete(name);
  }
  invalidateAllToolsCache();
}
