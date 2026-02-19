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
import { getTool, type InteractionRequestEvent, type InteractionResponse } from "../registry.ts";
import { DEFAULT_TIMEOUTS } from "../constants.ts";
import { type AgentPolicy, resolvePolicyDecision } from "../policy.ts";
import {
  isObjectValue,
  TEXT_ENCODER,
  truncate,
} from "../../../common/utils.ts";
import { isToolArgsObject } from "../validation.ts";
import { classifyShellCommand } from "./shell-classifier.ts";

// TEXT_ENCODER imported from common/utils.ts (SSOT)

// ============================================================
// Types
// ============================================================

/** Safety levels for tool execution */
export type SafetyLevel = "L0" | "L1" | "L2";

/** Classification result with reasoning */
interface SafetyClassification {
  level: SafetyLevel;
  reason: string;
}

/** Confirmation result from user */
interface ConfirmationResult {
  confirmed: boolean;
  rememberChoice?: boolean;
}

// ============================================================
// L1 Confirmation Tracking
// ============================================================

/**
 * Track which tools have been confirmed at L1.
 *
 * Key strategy:
 * - shell_exec: tool + canonical args (stricter, command-specific)
 * - all other L1 tools: tool name only (session-level, reduces prompt churn)
 *
 * Examples:
 * - shell_exec + {"command":"git status"} -> "shell_exec:{...}"
 * - web_fetch + {url:"..."} -> "web_fetch"
 * - mcp/playwright/render_url + {...} -> "mcp/playwright/render_url"
 *
 * Value: true if confirmed
 */
const l1Confirmations = new Map<string, boolean>();
/** Prevent unbounded growth — evict oldest entries when cap is reached */
const MAX_L1_CONFIRMATIONS = 1000;

function getConfirmationStore(
  store?: Map<string, boolean>,
): Map<string, boolean> {
  return store ?? l1Confirmations;
}

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
 * Generate confirmation key for a tool invocation.
 *
 * shell_exec remains strict (per-args). Other read-mostly L1 tools are
 * per-tool to avoid repeatedly asking for every argument variation.
 *
 * @param toolName Tool name
 * @param args Tool arguments
 * @returns Confirmation key for cache lookup
 */
function makeL1Key(toolName: string, args: unknown): string {
  if (toolName !== "shell_exec") {
    return toolName;
  }

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
export function hasL1Confirmation(
  toolName: string,
  args: unknown,
  store?: Map<string, boolean>,
): boolean {
  const key = makeL1Key(toolName, args);
  return getConfirmationStore(store).get(key) === true;
}

/**
 * Mark tool+args combination as L1 confirmed
 *
 * @param toolName Tool name to confirm
 * @param args Tool arguments
 */
export function setL1Confirmation(
  toolName: string,
  args: unknown,
  store?: Map<string, boolean>,
): void {
  const confirmations = getConfirmationStore(store);
  const key = makeL1Key(toolName, args);
  // Evict oldest entry if at capacity (Map preserves insertion order)
  if (confirmations.size >= MAX_L1_CONFIRMATIONS && !confirmations.has(key)) {
    const oldest = confirmations.keys().next().value;
    if (oldest !== undefined) confirmations.delete(oldest);
  }
  confirmations.set(key, true);
}

/**
 * Clear L1 confirmation for tool+args combination
 *
 * @param toolName Tool name to clear
 * @param args Tool arguments
 */
export function clearL1Confirmation(
  toolName: string,
  args: unknown,
  store?: Map<string, boolean>,
): void {
  const key = makeL1Key(toolName, args);
  getConfirmationStore(store).delete(key);
}

/**
 * Clear all L1 confirmations
 */
export function clearAllL1Confirmations(store?: Map<string, boolean>): void {
  getConfirmationStore(store).clear();
}

/**
 * Get all L1 confirmations
 *
 * @returns Map of confirmed tools
 */
export function getAllL1Confirmations(
  store?: Map<string, boolean>,
): Map<string, boolean> {
  return new Map(getConfirmationStore(store));
}

// ============================================================
// Tool Classification
// ============================================================

/**
 * Get declared safety classification from tool metadata (SSOT).
 */
function getDeclaredSafetyClassification(
  toolName: string,
  ownerId?: string,
): SafetyClassification | null {
  try {
    const tool = getTool(toolName, ownerId);
    const level = tool.safetyLevel ?? null;
    if (!level) return null;

    const reason =
      typeof tool.safety === "string" && tool.safety.trim().length > 0
        ? tool.safety
        : level === "L0"
        ? "Read-only operation with no side effects"
        : level === "L1"
        ? "Low-risk operation requiring one-time confirmation"
        : "Destructive or mutating operation requires confirmation";

    return { level, reason };
  } catch {
    return null;
  }
}

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
  ownerId?: string,
): SafetyClassification {
  // L1/L2: shell_exec requires argument inspection
  if (toolName === "shell_exec") {
    return classifyShellExec(args);
  }

  // Use declared safety level from tool metadata (SSOT)
  const declared = getDeclaredSafetyClassification(toolName, ownerId);
  if (declared) {
    return declared;
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
  if (!isToolArgsObject(args)) {
    return {
      level: "L2",
      reason: "Shell command requires confirmation (invalid args)",
    };
  }

  if (
    !("command" in args) ||
    typeof (args as { command: unknown }).command !== "string"
  ) {
    return {
      level: "L2",
      reason: "Shell command requires confirmation (invalid args)",
    };
  }

  const command = (args as { command: string }).command;
  const classification = classifyShellCommand(command);
  return classification.level === "L1"
    ? { level: "L1", reason: classification.reason }
    : { level: "L2", reason: classification.reason };
}

// ============================================================
// User Confirmation
// ============================================================

/**
 * Prompt user for confirmation with timeout
 *
 * Displays tool information and asks user to confirm execution.
 * L1 confirmations are auto-remembered by checkToolSafety.
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
/**
 * Format tool-specific preview for richer confirmation display.
 */
function formatToolPreview(toolName: string, args: unknown): string {
  if (!isToolArgsObject(args)) {
    return truncate(JSON.stringify(args, null, 2), 200);
  }

  const a = args as Record<string, unknown>;

  if (toolName === "edit_file") {
    const lines: string[] = [];
    if (a.path) lines.push(`  path: ${a.path}`);
    if (a.find) lines.push(`  find: ${truncate(String(a.find), 80)}`);
    if (a.replace !== undefined) {
      lines.push(`  replace: ${truncate(String(a.replace), 80)}`);
    }
    if (a.mode !== undefined) lines.push(`  mode: ${a.mode}`);
    return lines.join("\n");
  }

  if (toolName === "write_file") {
    const lines: string[] = [];
    if (a.path) lines.push(`  path: ${a.path}`);
    if (typeof a.content === "string") {
      const preview = a.content.split("\n").slice(0, 10).join("\n");
      lines.push(`  content (first 10 lines):\n${truncate(preview, 300)}`);
    }
    return lines.join("\n");
  }

  if (toolName === "shell_exec") {
    return `  command: ${truncate(String(a.command ?? ""), 200)}`;
  }

  if (toolName === "shell_script") {
    const preview = String(a.script ?? "").split("\n").slice(0, 10).join("\n");
    return `  script:\n${truncate(preview, 300)}`;
  }

  if (toolName === "git_commit") {
    const lines: string[] = [];
    if (a.message) lines.push(`  message: ${truncate(String(a.message), 120)}`);
    if (Array.isArray(a.files)) lines.push(`  files: ${a.files.join(", ")}`);
    if (a.all) lines.push(`  all: true`);
    return lines.join("\n");
  }

  if (toolName === "delete_file") {
    return `  path: ${a.path}`;
  }

  return truncate(JSON.stringify(args, null, 2), 200);
}

async function promptUserConfirmation(
  toolName: string,
  args: unknown,
  classification: SafetyClassification,
  onInteraction?: (event: InteractionRequestEvent) => Promise<InteractionResponse>,
  timeoutMs: number = DEFAULT_TIMEOUTS.userInput,
): Promise<ConfirmationResult> {
  // GUI mode: emit interaction request and await response
  if (onInteraction) {
    const requestId = crypto.randomUUID();
    const response = await onInteraction({
      type: "interaction_request",
      requestId,
      mode: "permission",
      toolName,
      toolArgs: truncate(JSON.stringify(args, null, 2), 200),
    });
    return {
      confirmed: response.approved,
      rememberChoice: response.approved && (response.rememberChoice ?? false),
    };
  }

  // CLI mode: stdin-based confirmation
  const platform = getPlatform();

  // Helper to write to stdout
  const write = async (text: string) => {
    await platform.terminal.stdout.write(TEXT_ENCODER.encode(text));
  };

  // Format tool-specific preview
  const preview = formatToolPreview(toolName, args);

  // Display tool information
  await write("\n");
  await write(`[Tool: ${toolName}] (${classification.level})\n`);
  await write(preview + "\n");

  // Show appropriate prompt based on safety level
  const promptText = classification.level === "L1"
    ? "\nAllow? [y/n/a(lways)]: "
    : "\nAllow? [y/n]: ";
  await write(promptText);

  // Read user input with timeout
  const input = await readLine(platform, timeoutMs);

  // Timeout = automatic denial
  if (input === null) {
    await write("\n[Timeout - denied]\n");
    return {
      confirmed: false,
      rememberChoice: false,
    };
  }

  const trimmed = input.toLowerCase().trim();
  const confirmed = trimmed === "y" || trimmed === "a";
  const alwaysAllow = trimmed === "a";

  return {
    confirmed,
    rememberChoice: confirmed && (classification.level === "L1" || alwaysAllow),
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
 * 3. L1: Check confirmation cache, prompt once, auto-remember
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
  l1Store: Map<string, boolean>,
  ownerId?: string,
  onInteraction?: (event: InteractionRequestEvent) => Promise<InteractionResponse>,
): Promise<boolean> {
  // Classify tool
  const classification = classifyTool(toolName, args, ownerId);

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

  // L1: Check confirmation cache
  if (classification.level === "L1") {
    if (hasL1Confirmation(toolName, args, l1Store)) {
      return true;
    }

    // Prompt user
    const result = await promptUserConfirmation(
      toolName,
      args,
      classification,
      onInteraction,
    );

    if (result.confirmed && result.rememberChoice) {
      setL1Confirmation(toolName, args, l1Store);
    }

    return result.confirmed;
  }

  // L2: Always prompt
  const result = await promptUserConfirmation(toolName, args, classification, onInteraction);
  return result.confirmed;
}
