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
import { MEMORY_TOOLS } from "./tools/memory-tools.ts";
import { DATA_TOOLS } from "./tools/data-tools.ts";
import { GIT_TOOLS } from "./tools/git-tools.ts";
import { ValidationError } from "../../common/error.ts";
import type { AgentPolicy } from "./policy.ts";
import { isToolArgsObject } from "./validation.ts";
import {
  buildToolJsonSchema,
  coerceArgsToSchema,
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
}

/** Optional execution options passed to tools (e.g., cancellation signal) */
export interface ToolExecutionOptions {
  signal?: AbortSignal;
  policy?: AgentPolicy | null;
  onInteraction?: (event: InteractionRequestEvent) => Promise<InteractionResponse>;
}

/** Generic tool function signature */
export type ToolFunction = (
  args: unknown,
  workspace: string,
  options?: ToolExecutionOptions,
) => Promise<unknown>;

/** Tool metadata with function and documentation */
export interface ToolMetadata {
  fn: ToolFunction;
  description: string;
  args: Record<string, string>;
  returns?: Record<string, string>;
  safetyLevel?: "L0" | "L1" | "L2";
  safety?: string; // Additional safety info
  /** Skip argument validation (used for dynamic tools with unknown schemas) */
  skipValidation?: boolean;
  /** Optional formatter for tool results (for display/LLM output) */
  formatResult?: (result: unknown) => {
    returnDisplay: string;
    llmContent?: string;
  } | null;
}

/** Result of argument validation */
export interface ValidationResult {
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
      Promise.reject(new ValidationError(
        "delegate_agent is not configured. Ensure the session provides a delegate handler.",
        "delegate_agent",
      )),
    description:
      "Delegate a task to a specialist agent and return its result.",
    args: {
      agent: "string - Agent name (general, code, file, shell, web, memory)",
      task: "string - Task to delegate",
      maxToolCalls: "number (optional) - Max tool calls for the delegate",
      groundingMode: "string (optional) - off|warn|strict",
    },
    returns: {
      agent: "string",
      result: "string",
      stats: "object",
    },
    safetyLevel: "L0",
    safety: "Internal delegation (auto-approved).",
  },
  ...DATA_TOOLS,
  ...GIT_TOOLS,
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

function invalidateAllToolsCache(): void {
  _allToolsCache = null;
  _ownerToolsCache.clear();
  _normalizedNameMap = null;
  _toolCount = null;
  _toolWordSets = null;
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
  if (allowlist.length > 0) {
    const selected: Record<string, ToolMetadata> = {};
    for (const name of allowlist) {
      selected[name] = tools[name];
    }
    return selected;
  }

  const denylist = options?.denylist?.filter((name) => name in tools) ?? [];
  if (denylist.length > 0) {
    const denySet = new Set(denylist);
    const selected: Record<string, ToolMetadata> = {};
    for (const [name, tool] of Object.entries(tools)) {
      if (!denySet.has(name)) {
        selected[name] = tool;
      }
    }
    return selected;
  }

  return tools;
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
    agent: ["delegate_agent"],
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
  const errors = validateArgsAgainstSchema(args, schema);

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
  const coercedArgs = coerceArgsToSchema(args, schema);
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
