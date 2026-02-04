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
import { AGENT_TOOLS } from "./tools/agent-tools.ts";
import { DATA_TOOLS } from "./tools/data-tools.ts";
import { ValidationError } from "../../common/error.ts";
import type { AgentPolicy } from "./policy.ts";
import { isToolArgsObject } from "./validation.ts";
import { buildToolJsonSchema, validateArgsAgainstSchema } from "./tool-schema.ts";

// ============================================================
// Types
// ============================================================

/** Optional execution options passed to tools (e.g., cancellation signal) */
export interface ToolExecutionOptions {
  signal?: AbortSignal;
  policy?: AgentPolicy | null;
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
  ...AGENT_TOOLS,
  ...DATA_TOOLS,
} as Record<string, ToolMetadata>;

/**
 * Dynamic registry for external tools (e.g., MCP)
 *
 * Stored separately to avoid mutating static registry.
 */
const DYNAMIC_TOOL_REGISTRY: Record<string, ToolMetadata> = {};

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
export function getTool(name: string): ToolMetadata {
  const tool = DYNAMIC_TOOL_REGISTRY[name] ?? TOOL_REGISTRY[name];

  if (!tool) {
    const available = Object.keys(getAllTools()).join(", ");
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
export function getAllTools(): Record<string, ToolMetadata> {
  return { ...TOOL_REGISTRY, ...DYNAMIC_TOOL_REGISTRY };
}

/**
 * Resolve tools with optional allow/deny filtering.
 */
export function resolveTools(
  options?: { allowlist?: string[]; denylist?: string[] },
): Record<string, ToolMetadata> {
  const tools = getAllTools();
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
    const selected: Record<string, ToolMetadata> = {};
    for (const [name, tool] of Object.entries(tools)) {
      if (!denylist.includes(name)) {
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
  dynamic: string[];
} {
  return {
    file: Object.keys(FILE_TOOLS),
    code: Object.keys(CODE_TOOLS),
    shell: Object.keys(SHELL_TOOLS),
    meta: Object.keys(META_TOOLS),
    web: Object.keys(WEB_TOOLS),
    memory: Object.keys(MEMORY_TOOLS),
    agent: Object.keys(AGENT_TOOLS),
    data: Object.keys(DATA_TOOLS),
    dynamic: Object.keys(DYNAMIC_TOOL_REGISTRY),
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
export function hasTool(name: string): boolean {
  return name in TOOL_REGISTRY || name in DYNAMIC_TOOL_REGISTRY;
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
): ValidationResult {
  const tool = getTool(name);
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
 * Get tool count
 *
 * @returns Total number of registered tools
 */
export function getToolCount(): number {
  return Object.keys(getAllTools()).length;
}

/**
 * Get tool description
 *
 * @param name Tool name
 * @returns Human-readable description
 * @throws Error if tool not found
 */
export function getToolDescription(name: string): string {
  const tool = getTool(name);
  return tool.description;
}

/**
 * Get tool argument schema
 *
 * @param name Tool name
 * @returns Argument names and descriptions
 * @throws Error if tool not found
 */
export function getToolArgSchema(name: string): Record<string, string> {
  const tool = getTool(name);
  return { ...tool.args };
}

// ============================================================
// Dynamic Tool Registration (e.g., MCP)
// ============================================================

/**
 * Register a dynamic tool by name.
 *
 * Throws if the tool name collides with a built-in tool.
 */
export function registerTool(name: string, tool: ToolMetadata): void {
  if (name in TOOL_REGISTRY) {
    throw new ValidationError(
      `Tool '${name}' already exists in built-in registry`,
      "tool_registry",
    );
  }
  if (name in DYNAMIC_TOOL_REGISTRY) {
    throw new ValidationError(
      `Tool '${name}' already exists in dynamic registry`,
      "tool_registry",
    );
  }
  DYNAMIC_TOOL_REGISTRY[name] = tool;
}

/**
 * Register multiple dynamic tools.
 *
 * Returns the list of registered tool names.
 */
export function registerTools(tools: Record<string, ToolMetadata>): string[] {
  const registered: string[] = [];
  for (const [name, tool] of Object.entries(tools)) {
    registerTool(name, tool);
    registered.push(name);
  }
  return registered;
}

/**
 * Unregister a dynamic tool by name.
 */
export function unregisterTool(name: string): void {
  delete DYNAMIC_TOOL_REGISTRY[name];
}
