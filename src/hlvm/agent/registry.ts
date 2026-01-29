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
import { ValidationError } from "../../common/error.ts";
import type { AgentPolicy } from "./policy.ts";
import { isToolArgsObject } from "./validation.ts";

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
 */
export const TOOL_REGISTRY: Record<string, ToolMetadata> = {
  ...FILE_TOOLS,
  ...CODE_TOOLS,
  ...SHELL_TOOLS,
  ...META_TOOLS,
} as Record<string, ToolMetadata>;

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
  const tool = TOOL_REGISTRY[name];

  if (!tool) {
    const available = Object.keys(TOOL_REGISTRY).join(", ");
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
  return { ...TOOL_REGISTRY };
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
} {
  return {
    file: Object.keys(FILE_TOOLS),
    code: Object.keys(CODE_TOOLS),
    shell: Object.keys(SHELL_TOOLS),
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
  return name in TOOL_REGISTRY;
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
  const errors: string[] = [];

  // Check args is an object
  if (!isToolArgsObject(args)) {
    errors.push("Arguments must be a plain object");
    return { valid: false, errors };
  }

  // Extract required argument names from metadata
  // Format: "name: string - description" or "name: string (optional) - description"
  const argNames = Object.keys(tool.args);
  const requiredArgs = argNames.filter((key) => {
    const value = tool.args[key];
    return !value.includes("(optional)");
  });

  // Check required arguments are present
  const providedArgs = args as Record<string, unknown>;
  for (const required of requiredArgs) {
    if (!(required in providedArgs)) {
      errors.push(`Missing required argument: ${required}`);
    }
  }

  // Check for unexpected arguments
  const validArgNames = argNames;
  for (const provided of Object.keys(providedArgs)) {
    if (!validArgNames.includes(provided)) {
      errors.push(
        `Unexpected argument: ${provided}. Valid arguments: ${
          validArgNames.join(", ")
        }`,
      );
    }
  }

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
  return Object.keys(TOOL_REGISTRY).length;
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
