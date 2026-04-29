// 3-tier safety model: L0 auto-approve (read-only), L1 confirm-once-then-remember, L2 always-confirm.

import { getPlatform } from "../../../platform/platform.ts";
import {
  getTool,
  resolveTools,
  type InteractionRequestEvent,
  type InteractionResponse,
} from "../registry.ts";
import { DEFAULT_TIMEOUTS } from "../constants.ts";
import {
  TEXT_ENCODER,
  truncate,
} from "../../../common/utils.ts";
import { isToolArgsObject } from "../validation.ts";
import { classifyShellCommand, classifyShellPipeline } from "./shell-classifier.ts";
import { canonicalizeForSignature } from "../orchestrator-tool-formatting.ts";
import type { PermissionMode, ToolPermissions } from "../../../common/config/types.ts";

export type SafetyLevel = "L0" | "L1" | "L2";

interface SafetyClassification {
  level: SafetyLevel;
  reason: string;
}

interface ConfirmationResult {
  confirmed: boolean;
  rememberChoice?: boolean;
}

// shell_exec keys include canonical args (per-command); other L1 tools key by name (per-session) to avoid
// asking again for every argument variation.
const l1Confirmations = new Map<string, boolean>();
const MAX_L1_CONFIRMATIONS = 1000;

function getConfirmationStore(
  store?: Map<string, boolean>,
): Map<string, boolean> {
  return store ?? l1Confirmations;
}

function makeL1Key(toolName: string, args: unknown): string {
  if (toolName !== "shell_exec") return toolName;
  return `${toolName}:${JSON.stringify(canonicalizeForSignature(args))}`;
}

export function hasL1Confirmation(
  toolName: string,
  args: unknown,
  store?: Map<string, boolean>,
): boolean {
  return getConfirmationStore(store).get(makeL1Key(toolName, args)) === true;
}

export function setL1Confirmation(
  toolName: string,
  args: unknown,
  store?: Map<string, boolean>,
): void {
  const confirmations = getConfirmationStore(store);
  const key = makeL1Key(toolName, args);
  // Map preserves insertion order — drop the oldest key when we hit the cap.
  if (confirmations.size >= MAX_L1_CONFIRMATIONS && !confirmations.has(key)) {
    const oldest = confirmations.keys().next().value;
    if (oldest !== undefined) confirmations.delete(oldest);
  }
  confirmations.set(key, true);
}

export function clearL1Confirmation(
  toolName: string,
  args: unknown,
  store?: Map<string, boolean>,
): void {
  getConfirmationStore(store).delete(makeL1Key(toolName, args));
}

export function clearAllL1Confirmations(store?: Map<string, boolean>): void {
  getConfirmationStore(store).clear();
}

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

function isDeclaredMutatingTool(
  toolName: string,
  ownerId?: string,
  args?: Record<string, unknown>,
): boolean {
  try {
    const tool = getTool(toolName, ownerId);
    if (tool.category === "write" || toolName === "git_commit") return true;
    if (toolName === "shell_exec" || toolName === "shell_script") {
      const cmd = toolName === "shell_exec"
        ? args?.command
        : (args?.script ?? args?.command);
      if (cmd && typeof cmd === "string") {
        return classifyShellPipeline(cmd).level !== "L0";
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function classifyTool(
  toolName: string,
  args?: unknown,
  ownerId?: string,
): SafetyClassification {
  if (toolName === "shell_exec") return classifyShellExec(args);
  const declared = getDeclaredSafetyClassification(toolName, ownerId);
  if (declared) return declared;
  return {
    level: "L2",
    reason: "Unknown tool, defaulting to highest safety level",
  };
}

export function isMutatingTool(
  toolName: string,
  ownerId?: string,
  args?: Record<string, unknown>,
): boolean {
  return isDeclaredMutatingTool(toolName, ownerId, args);
}

export function effectiveToolSurfaceIncludesMutation(options?: {
  allowlist?: string[];
  denylist?: string[];
  ownerId?: string;
}): boolean {
  const tools = resolveTools(options);
  return Object.keys(tools).some((toolName) =>
    isDeclaredMutatingTool(toolName, options?.ownerId)
  );
}

function classifyShellExec(args: unknown): SafetyClassification {
  if (!isToolArgsObject(args) || typeof (args as { command?: unknown }).command !== "string") {
    return {
      level: "L2",
      reason: "Shell command requires confirmation (invalid args)",
    };
  }
  const { level, reason } = classifyShellPipeline(
    (args as { command: string }).command,
  );
  return { level, reason };
}

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
  warning?: string,
  timeoutMs: number = DEFAULT_TIMEOUTS.userInput,
): Promise<ConfirmationResult> {
  // GUI mode: emit interaction request and await response
  if (onInteraction) {
    const requestId = crypto.randomUUID();
    const toolArgs = [
      warning?.trim(),
      truncate(JSON.stringify(args, null, 2), 200),
    ].filter(Boolean).join("\n\n");
    const response = await onInteraction({
      type: "interaction_request",
      requestId,
      mode: "permission",
      toolName,
      toolArgs,
      toolInput: args,
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
  if (warning?.trim()) {
    await write(`${warning.trim()}\n`);
  }
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

/** Reads a line from stdin, returning null on timeout. */
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

  try {
    return await Promise.race([readPromise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/** Resolves whether to allow, deny, prompt, or auto-classify a tool call.
 *  Priority: explicit deny > explicit allow > L0 auto-approve > permission-mode policy. */
export function resolveToolPermission(
  toolName: string,
  safetyLevel: SafetyLevel,
  permissions: ToolPermissions,
): "allow" | "deny" | "prompt" | "auto-classify" {
  if (permissions.deniedTools.has(toolName)) return "deny";
  if (permissions.allowedTools.has(toolName)) return "allow";
  if (safetyLevel === "L0") return "allow";
  if (permissions.mode === "dontAsk") return "deny";
  if (permissions.mode === "bypassPermissions") return "allow";
  if (permissions.mode === "acceptEdits" && safetyLevel === "L1") return "allow";
  if (permissions.mode === "auto") return "auto-classify";
  return "prompt";
}

export async function checkToolSafety(
  toolName: string,
  args: unknown,
  permissionMode: PermissionMode = "default",
  l1Store: Map<string, boolean>,
  ownerId?: string,
  onInteraction?: (event: InteractionRequestEvent) => Promise<InteractionResponse>,
  warning?: string,
  toolPermissions?: { allowedTools?: Set<string>; deniedTools?: Set<string> },
  options?: {
    /** Injectable classifier for auto mode (tests inject a stub). */
    classifyToolSafety?: (
      toolName: string,
      args: Record<string, unknown>,
    ) => Promise<{ safe: boolean; reason: string }>;
  },
): Promise<boolean> {
  const classification = classifyTool(toolName, args, ownerId);
  const decision = resolveToolPermission(toolName, classification.level, {
    allowedTools: toolPermissions?.allowedTools ?? new Set(),
    deniedTools: toolPermissions?.deniedTools ?? new Set(),
    mode: permissionMode,
  });
  if (decision === "deny") return false;
  if (decision === "allow") return true;

  // Auto mode: ask the local LLM classifier; fall through to prompt if unsafe or it errors.
  if (decision === "auto-classify") {
    if (
      classification.level === "L1" &&
      hasL1Confirmation(toolName, args, l1Store)
    ) {
      return true;
    }
    try {
      const classifyFn = options?.classifyToolSafety ??
        (await import("../../runtime/local-llm.ts")).classifyToolSafety;
      const result = await classifyFn(
        toolName,
        args as Record<string, unknown>,
      );
      if (result.safe) {
        if (classification.level === "L1") {
          setL1Confirmation(toolName, args, l1Store);
        }
        return true;
      }
    } catch { /* classifier failed — fall through to prompt */ }
  }

  if (
    classification.level === "L1" &&
    hasL1Confirmation(toolName, args, l1Store)
  ) {
    return true;
  }

  const result = await promptUserConfirmation(
    toolName,
    args,
    classification,
    onInteraction,
    warning,
  );

  if (
    classification.level === "L1" && result.confirmed && result.rememberChoice
  ) {
    setL1Confirmation(toolName, args, l1Store);
  }

  return result.confirmed;
}
