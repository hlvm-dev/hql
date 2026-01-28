/**
 * Safety Classifier - Tool execution safety levels and user confirmation
 *
 * Implements 3-tier safety model:
 * - L0 (auto-approve): Read-only operations with no side effects
 * - L1 (confirm once): Operations confirmed once, then remembered
 * - L2 (always confirm): Destructive/mutating operations always require confirmation
 *
 * Features:
 * - Tool classification based on operation type
 * - L1 confirmation tracking (in-memory)
 * - User confirmation prompts via terminal
 * - SSOT-compliant (uses getPlatform)
 */

import { getPlatform } from "../../../platform/platform.ts";
import { getTool } from "../registry.ts";
import { DEFAULT_TIMEOUTS, SHELL_ALLOWLIST_L1 } from "../constants.ts";
import { resolvePolicyDecision, type AgentPolicy } from "../policy.ts";
import { isObjectValue } from "../../../common/utils.ts";

// ============================================================
// Types
// ============================================================

/** Safety levels for tool execution */
export type SafetyLevel = "L0" | "L1" | "L2";

/** Classification result with reasoning */
export interface SafetyClassification {
  level: SafetyLevel;
  reason: string;
}

/** Confirmation result from user */
export interface ConfirmationResult {
  confirmed: boolean;
  rememberChoice?: boolean;
}

// ============================================================
// L1 Confirmation Tracking (Issue #11: Per-args confirmation)
// ============================================================

/**
 * Track which tools+args have been confirmed at L1
 * Key: tool name + serialized args (e.g., "read_file:{\"path\":\"src/main.ts\"}")
 * Value: true if confirmed
 */
const l1Confirmations = new Map<string, boolean>();

/**
 * Canonicalize object by sorting keys recursively
 *
 * Ensures consistent key ordering for stable hashing.
 * Handles nested objects and arrays.
 *
 * @param obj Object to canonicalize
 * @returns Canonicalized object with sorted keys
 */
function canonicalizeObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(canonicalizeObject);
  }

  if (isObjectValue(obj)) {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj).sort();
    for (const key of keys) {
      sorted[key] = canonicalizeObject((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  return obj;
}

/**
 * Generate unique key for tool + args combination
 *
 * Uses canonical JSON serialization to ensure consistent keys
 * regardless of property order.
 *
 * @param toolName Tool name
 * @param args Tool arguments
 * @returns Unique key for this specific tool call
 *
 * @example
 * ```ts
 * // These produce the same key:
 * makeL1Key("shell_exec", {command: "ls", cwd: "/tmp"})
 * makeL1Key("shell_exec", {cwd: "/tmp", command: "ls"})
 * ```
 */
function makeL1Key(toolName: string, args: unknown): string {
  // Canonicalize args to ensure consistent key ordering
  const canonical = canonicalizeObject(args);
  const argsJson = JSON.stringify(canonical);
  return `${toolName}:${argsJson}`;
}

/**
 * Check if tool+args combination has L1 confirmation
 *
 * @param toolName Tool name to check
 * @param args Tool arguments
 * @returns True if this specific tool+args has been confirmed
 */
export function hasL1Confirmation(toolName: string, args: unknown): boolean {
  const key = makeL1Key(toolName, args);
  return l1Confirmations.get(key) === true;
}

/**
 * Mark tool+args combination as L1 confirmed
 *
 * @param toolName Tool name to confirm
 * @param args Tool arguments
 */
export function setL1Confirmation(toolName: string, args: unknown): void {
  const key = makeL1Key(toolName, args);
  l1Confirmations.set(key, true);
}

/**
 * Clear L1 confirmation for tool+args combination
 *
 * @param toolName Tool name to clear
 * @param args Tool arguments
 */
export function clearL1Confirmation(toolName: string, args: unknown): void {
  const key = makeL1Key(toolName, args);
  l1Confirmations.delete(key);
}

/**
 * Clear all L1 confirmations
 */
export function clearAllL1Confirmations(): void {
  l1Confirmations.clear();
}

/**
 * Get all L1 confirmations
 *
 * @returns Map of confirmed tools
 */
export function getAllL1Confirmations(): Map<string, boolean> {
  return new Map(l1Confirmations);
}

// ============================================================
// Tool Classification
// ============================================================

/**
 * L0 (auto-approve) tools - Read-only with no side effects
 *
 * These tools only read data and have no destructive capabilities:
 * - read_file: Read file contents
 * - list_files: List directory contents
 * - search_code: Search code patterns
 * - find_symbol: Find symbol declarations
 * - get_structure: Get directory tree
 * - ask_user: Ask user for clarification (safe interaction)
 */
const L0_TOOLS = new Set([
  "read_file",
  "list_files",
  "search_code",
  "find_symbol",
  "get_structure",
  "ask_user",
]);

/**
 * L1 (confirm once) tools - Low-risk operations
 *
 * These tools have limited side effects and can be confirmed once:
 * - shell_exec with allow-list (git status/log/diff, deno test --dry-run)
 */
const L1_TOOLS = new Set([
  // shell_exec is L1 only when command is in allow-list
  // This is checked dynamically in classifyShellExec()
]);

/**
 * L2 (always confirm) tools - Destructive/mutating operations
 *
 * These tools modify state and always require confirmation:
 * - write_file: Write/modify files
 * - shell_exec: Execute arbitrary commands (default)
 * - shell_script: Execute arbitrary scripts
 */
const L2_TOOLS = new Set([
  "write_file",
  "shell_exec",
  "shell_script",
]);

/**
 * Classify tool execution safety level
 *
 * Rules:
 * 1. Read-only tools → L0 (auto-approve)
 * 2. shell_exec with allow-list command → L1 (confirm once)
 * 3. Destructive/mutating tools → L2 (always confirm)
 *
 * @param toolName Tool name to classify
 * @param args Tool arguments (used for shell_exec classification)
 * @returns Safety classification with level and reason
 *
 * @example
 * ```ts
 * const classification = classifyTool("read_file", { path: "src/main.ts" });
 * // Returns: { level: "L0", reason: "Read-only operation with no side effects" }
 *
 * const shellClassification = classifyTool("shell_exec", { command: "git status" });
 * // Returns: { level: "L1", reason: "Allow-listed read-only command: git status" }
 * ```
 */
export function classifyTool(
  toolName: string,
  args?: unknown,
): SafetyClassification {
  // L0: Read-only tools
  if (L0_TOOLS.has(toolName)) {
    return {
      level: "L0",
      reason: "Read-only operation with no side effects",
    };
  }

  // L1/L2: shell_exec requires argument inspection
  if (toolName === "shell_exec") {
    return classifyShellExec(args);
  }

  // L2: Destructive/mutating tools
  if (L2_TOOLS.has(toolName)) {
    return {
      level: "L2",
      reason: "Destructive or mutating operation requires confirmation",
    };
  }

  // Default to L2 for unknown tools (safe default)
  return {
    level: "L2",
    reason: "Unknown tool, defaulting to highest safety level",
  };
}

/**
 * Classify shell_exec command
 *
 * Checks if command is in allow-list:
 * - git status, git log, git diff → L1
 * - deno test --dry-run → L1
 * - All other commands → L2
 *
 * @param args shell_exec arguments
 * @returns Safety classification
 */
function classifyShellExec(args: unknown): SafetyClassification {
  // Extract command from args
  if (
    typeof args !== "object" || args === null ||
    !("command" in args) ||
    typeof (args as { command: unknown }).command !== "string"
  ) {
    return {
      level: "L2",
      reason: "Shell command requires confirmation (invalid args)",
    };
  }

  const command = (args as { command: string }).command.trim();

  for (const pattern of SHELL_ALLOWLIST_L1) {
    if (pattern.test(command)) {
      return {
        level: "L1",
        reason: `Allow-listed read-only command: ${command}`,
      };
    }
  }

  return {
    level: "L2",
    reason: `Shell command requires confirmation: ${command}`,
  };
}

// ============================================================
// User Confirmation
// ============================================================

/**
 * Prompt user for confirmation with timeout (Issue #12)
 *
 * Displays tool information and asks user to confirm execution.
 * For L1 tools, asks if user wants to remember the choice.
 * Times out after 60 seconds if no response.
 *
 * @param toolName Tool name
 * @param args Tool arguments
 * @param classification Safety classification
 * @param timeoutMs Timeout in milliseconds (default: 60000 = 60s)
 * @returns Confirmation result (timeout treated as denial)
 *
 * @example
 * ```ts
 * const result = await promptUserConfirmation(
 *   "write_file",
 *   { path: "src/main.ts", content: "..." },
 *   { level: "L2", reason: "Destructive operation" }
 * );
 * if (result.confirmed) {
 *   // Execute tool
 * }
 * ```
 */
export async function promptUserConfirmation(
  toolName: string,
  args: unknown,
  classification: SafetyClassification,
  timeoutMs: number = DEFAULT_TIMEOUTS.userInput,
): Promise<ConfirmationResult> {
  const platform = getPlatform();
  const encoder = new TextEncoder();

  // Helper to write to stdout
  const write = async (text: string) => {
    await platform.terminal.stdout.write(encoder.encode(text));
  };

  // Format args for display (truncate if too long)
  const argsStr = JSON.stringify(args, null, 2);
  const displayArgs = argsStr.length > 200
    ? argsStr.substring(0, 200) + "..."
    : argsStr;

  // Display tool information
  await write("\n");
  await write("=".repeat(60) + "\n");
  await write(`Tool: ${toolName}\n`);
  await write(`Safety: ${classification.level}\n`);
  await write(`Reason: ${classification.reason}\n`);
  await write("Arguments:\n");
  await write(displayArgs + "\n");
  await write("=".repeat(60) + "\n");

  // Prompt for confirmation with timeout
  await write("\nConfirm execution? (y/n): ");

  // Read user input with timeout
  const input = await readLine(platform, timeoutMs);

  // Timeout = automatic denial
  if (input === null) {
    await write("\n[Timeout - confirmation denied]\n");
    return {
      confirmed: false,
      rememberChoice: false,
    };
  }

  const confirmed = input.toLowerCase().trim() === "y";

  // For L1 tools, ask if user wants to remember
  let rememberChoice = false;
  if (confirmed && classification.level === "L1") {
    await write("Remember this choice for future executions? (y/n): ");
    const rememberInput = await readLine(platform, timeoutMs);

    // Timeout on remember question = don't remember
    if (rememberInput === null) {
      await write("\n[Timeout - choice not remembered]\n");
      rememberChoice = false;
    } else {
      rememberChoice = rememberInput.toLowerCase().trim() === "y";
    }
  }

  return {
    confirmed,
    rememberChoice,
  };
}

/**
 * Read a line of input from terminal with timeout (Issue #12)
 *
 * Helper function to read user input until newline.
 * Uses platform terminal abstraction with timeout support.
 *
 * @param platform Platform instance
 * @param timeoutMs Timeout in milliseconds (default: 60000 = 60s)
 * @returns User input as string, or null if timeout
 */
async function readLine(
  platform: ReturnType<typeof getPlatform>,
  timeoutMs: number = 60000,
): Promise<string | null> {
  const decoder = new TextDecoder();
  const buffer: string[] = [];

  // Create timeout promise with cleanup
  let timeoutId: number | undefined;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), timeoutMs);
  });

  // Read byte by byte until newline with timeout
  const readPromise = (async () => {
    while (true) {
      const byte = new Uint8Array(1);
      const bytesRead = await platform.terminal.stdin.read(byte);

      if (bytesRead === null || bytesRead === 0) {
        break;
      }

      const char = decoder.decode(byte);

      if (char === "\n" || char === "\r") {
        break;
      }

      buffer.push(char);
    }

    return buffer.join("");
  })();

  // Race between reading and timeout
  try {
    const result = await Promise.race([readPromise, timeoutPromise]);

    // Clean up timeout
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    return result;
  } catch (error) {
    // Clean up timeout on error
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    throw error;
  }
}

// ============================================================
// Safety Check (Combined)
// ============================================================

/**
 * Check if tool execution should proceed
 *
 * Combines classification and confirmation logic:
 * 1. Classify tool → L0/L1/L2
 * 2. L0: Auto-approve
 * 3. L1: Check confirmation cache, prompt if needed
 * 4. L2: Always prompt
 *
 * @param toolName Tool name
 * @param args Tool arguments
 * @param autoApprove If true, skip all confirmations (for testing/automation)
 * @returns True if execution should proceed
 *
 * @example
 * ```ts
 * const shouldExecute = await checkToolSafety(
 *   "write_file",
 *   { path: "src/main.ts", content: "..." }
 * );
 * if (shouldExecute) {
 *   // Execute tool
 * }
 * ```
 */
export async function checkToolSafety(
  toolName: string,
  args: unknown,
  autoApprove = false,
  policy: AgentPolicy | null = null,
): Promise<boolean> {
  // Classify tool
  const classification = classifyTool(toolName, args);

  // Apply policy override if present
  const policyDecision = resolvePolicyDecision(
    policy,
    toolName,
    classification.level,
  );
  if (policyDecision === "deny") {
    return false;
  }
  if (policyDecision === "allow") {
    return true;
  }

  // Auto-approve mode (for testing/automation)
  if (autoApprove) {
    return true;
  }

  // L0: Auto-approve
  if (classification.level === "L0") {
    return true;
  }

  // L1: Check confirmation cache (per-args - Issue #11)
  if (classification.level === "L1") {
    if (hasL1Confirmation(toolName, args)) {
      return true;
    }

    // Prompt user
    const result = await promptUserConfirmation(
      toolName,
      args,
      classification,
    );

    if (result.confirmed && result.rememberChoice) {
      setL1Confirmation(toolName, args);
    }

    return result.confirmed;
  }

  // L2: Always prompt
  const result = await promptUserConfirmation(toolName, args, classification);
  return result.confirmed;
}
