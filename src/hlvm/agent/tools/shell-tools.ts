/**
 * Shell Tools - SSOT-compliant shell execution for AI agents
 *
 * Provides 2 core shell operations with security:
 * 1. shell_exec - Execute shell command with allow-list checking
 * 2. shell_script - Execute multi-line shell script
 *
 * Security features:
 * - L2 (always confirm) by default
 * - L1 (confirm once) for allow-listed commands
 * - All execution sandboxed to workspace
 * - Uses platform abstraction (getPlatform)
 */

import { getPlatform } from "../../../platform/platform.ts";
import { createAbortError } from "../../../common/timeout-utils.ts";
import { resolveToolPath } from "../path-utils.ts";
import {
  getUnsafeReason,
  isSafeCommand,
  parseShellCommand,
} from "../../../common/shell-parser.ts";
import { classifyShellCommand as classifyShellCommandWithReason } from "../security/shell-classifier.ts";
import { getNetworkPolicyDeniedUrl } from "../policy.ts";
import type { ToolExecutionOptions } from "../registry.ts";
import { failTool, formatToolError, okTool } from "../tool-results.ts";

// ============================================================
// Types
// ============================================================

/** Result of shell command execution */
interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  detached?: boolean;
}

/** Arguments for shell_exec tool */
export interface ShellExecArgs {
  command: string;
  cwd?: string;
  detach?: boolean;
}

/** Result of shell_exec operation */
interface ShellExecResult extends ShellResult {
  success: boolean;
  message?: string;
  safetyLevel?: "L0" | "L1" | "L2";
}

/** Arguments for shell_script tool */
export interface ShellScriptArgs {
  script: string;
  interpreter?: "bash" | "sh" | "cmd" | "powershell";
  cwd?: string;
}

/** Result of shell_script operation */
interface ShellScriptResult extends ShellResult {
  success: boolean;
  message?: string;
}

/**
 * Backward-compatible classifier returning only safety level.
 * Use classifyShellCommandWithReason for detailed reasons.
 */
export function classifyShellCommand(command: string): "L0" | "L1" | "L2" {
  return classifyShellCommandWithReason(command).level;
}

const DETACHED_LAUNCH_GRACE_MS = 75;

/**
 * Auto-detach a narrow set of macOS automation commands that can legitimately
 * take a long time (for example Finder emptying Trash) and should not block
 * the interactive REPL turn.
 */
export function shouldAutoDetachShellCommand(
  command: string,
  os: string,
): boolean {
  if (os !== "darwin") return false;

  const normalized = command.trim().toLowerCase();
  if (!normalized.includes("osascript") || !normalized.includes("finder")) {
    return false;
  }

  return normalized.includes("empty the trash") ||
    normalized.includes("empty trash");
}

async function launchDetachedShellCommand(
  platform: ReturnType<typeof getPlatform>,
  cmdArgs: string[],
  workDir: string,
  safetyLevel: "L0" | "L1" | "L2",
): Promise<ShellExecResult> {
  const process = platform.command.run({
    cmd: cmdArgs,
    cwd: workDir,
    stdout: "null",
    stderr: "null",
    stdin: "null",
  });

  process.unref?.();

  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const statusPromise = process.status;
  const launchState = await Promise.race([
    statusPromise.then((status) => ({ type: "status" as const, status })),
    new Promise<{ type: "detached" }>((resolve) => {
      graceTimer = setTimeout(
        () => resolve({ type: "detached" }),
        DETACHED_LAUNCH_GRACE_MS,
      );
    }),
  ]);

  if (graceTimer !== undefined) {
    clearTimeout(graceTimer);
  }

  if (launchState.type === "status") {
    const message = launchState.status.code === 0
      ? "Command executed successfully"
      : `Command exited with code ${launchState.status.code}`;

    if (launchState.status.code === 0) {
      return okTool({
        stdout: "",
        stderr: "",
        exitCode: launchState.status.code,
        safetyLevel,
        message,
      });
    }

    return failTool(message, {
      stdout: "",
      stderr: "",
      exitCode: launchState.status.code,
      safetyLevel,
    });
  }

  void statusPromise.catch(() => {});

  return okTool({
    stdout: "",
    stderr: "",
    exitCode: 0,
    detached: true,
    safetyLevel,
    message:
      "Command started in background; REPL is not waiting for it to finish.",
  });
}

// ============================================================
// Tool 1: shell_exec
// ============================================================

/**
 * Execute shell command
 *
 * Security:
 * - L2 (always confirm) by default
 * - L1 (confirm once) if command in allow-list
 * - Working directory validated with path sandboxing
 * - Uses platform command abstraction
 *
 * @example
 * ```ts
 * const result = await shellExec({
 *   command: "git status",
 *   cwd: "."
 * }, "/workspace");
 * // Returns: { success: true, stdout: "...", exitCode: 0, safetyLevel: "L1" }
 * ```
 */
export async function shellExec(
  args: ShellExecArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<ShellExecResult> {
  try {
    const platform = getPlatform();

    // Validate working directory
    const workDir = args.cwd
      ? await resolveToolPath(args.cwd, workspace, options?.policy ?? null)
      : workspace;

    // Classify command for safety level
    const safetyLevel = classifyShellCommand(args.command);

    // Parse command with proper quote/escape handling
    let parsedCommand;
    try {
      parsedCommand = parseShellCommand(args.command);
    } catch (error) {
      const toolError = formatToolError("Invalid shell command", error);
      return failTool(toolError.message, {
        stdout: "",
        stderr: toolError.error,
        exitCode: 1,
        safetyLevel,
      });
    }

    // Reject unsafe operators for shell_exec (use shell_script instead)
    if (!isSafeCommand(parsedCommand)) {
      const unsafeReason = getUnsafeReason(parsedCommand);
      return failTool(
        `Unsafe shell command for shell_exec: ${unsafeReason}. Use shell_script for complex commands.`,
        {
          stdout: "",
          stderr: unsafeReason,
          exitCode: 1,
          safetyLevel,
        },
      );
    }

    // isSafeCommand() above guarantees no pipes/chaining — safe for direct exec on all platforms
    const cmdArgs = [parsedCommand.program, ...parsedCommand.args];
    const detach = args.detach === true ||
      shouldAutoDetachShellCommand(args.command, platform.build.os);

    // Enforce optional network policy on URL-like args
    const urlSources = cmdArgs;
    const deniedUrl = getNetworkPolicyDeniedUrl(
      options?.policy,
      extractUrlsFromArgs(urlSources),
    );
    if (deniedUrl) {
      return failTool(`Network access denied by policy: ${deniedUrl}`, {
        stdout: "",
        stderr: `Network access denied by policy: ${deniedUrl}`,
        exitCode: 1,
        safetyLevel,
      });
    }

    if (options?.signal?.aborted) {
      throw createAbortError("Shell command aborted");
    }

    if (detach) {
      return await launchDetachedShellCommand(
        platform,
        cmdArgs,
        workDir,
        safetyLevel,
      );
    }

    // Execute using platform command API (run + drain streams for cancellation)
    const process = platform.command.run({
      cmd: cmdArgs,
      cwd: workDir,
      stdout: "piped",
      stderr: "piped",
      stdin: "null",
    });

    const abortHandler = createProcessAbortHandler(process, platform.build.os);
    let aborted = false;
    const onAbort = (): void => {
      aborted = true;
      abortHandler.abort();
    };

    if (options?.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      const [stdoutBytes, stderrBytes, status] = await Promise.all([
        readProcessStream(process.stdout, options?.signal),
        readProcessStream(process.stderr, options?.signal),
        process.status,
      ]);

      if (aborted) {
        throw createAbortError("Shell command aborted");
      }

      const stdout = new TextDecoder().decode(stdoutBytes);
      const stderr = new TextDecoder().decode(stderrBytes);
      const message = status.code === 0
        ? `Command executed successfully`
        : `Command exited with code ${status.code}`;

      if (status.code === 0) {
        return okTool({
          stdout,
          stderr,
          exitCode: status.code,
          safetyLevel,
          message,
        });
      }

      return failTool(message, {
        stdout,
        stderr,
        exitCode: status.code,
        safetyLevel,
      });
    } finally {
      if (options?.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
      abortHandler.clear();
    }
  } catch (error) {
    const toolError = formatToolError("Failed to execute command", error);
    return failTool(toolError.message, {
      stdout: "",
      stderr: toolError.error,
      exitCode: 1,
    });
  }
}

// ============================================================
// Tool 2: shell_script
// ============================================================

/**
 * Execute multi-line shell script
 *
 * Security:
 * - ALWAYS L2 (always confirm) - no allow-list
 * - Script written to temp file and executed
 * - Temp file automatically cleaned up
 * - Working directory validated with path sandboxing
 *
 * @example
 * ```ts
 * const result = await shellScript({
 *   script: `
 *     echo "Line 1"
 *     echo "Line 2"
 *   `,
 *   interpreter: "bash",
 *   cwd: "."
 * }, "/workspace");
 * ```
 */
export async function shellScript(
  args: ShellScriptArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<ShellScriptResult> {
  const platform = getPlatform();
  let tempDir: string | undefined;

  try {
    // Validate working directory
    const workDir = args.cwd
      ? await resolveToolPath(args.cwd, workspace, options?.policy ?? null)
      : workspace;

    const isWindows = platform.build.os === "windows";
    const interpreter = args.interpreter ||
      (isWindows ? "cmd" : "sh");

    // Enforce optional network policy on URLs in script
    const deniedUrl = getNetworkPolicyDeniedUrl(
      options?.policy,
      extractUrlsFromText(args.script),
    );
    if (deniedUrl) {
      return failTool(`Network access denied by policy: ${deniedUrl}`, {
        stdout: "",
        stderr: `Network access denied by policy: ${deniedUrl}`,
        exitCode: 1,
      });
    }

    // Create temp directory for script
    tempDir = await platform.fs.makeTempDir({ prefix: "hlvm-shell-" });
    const scriptExtension = interpreter === "powershell"
      ? "ps1"
      : interpreter === "cmd"
      ? "cmd"
      : "sh";
    const scriptPath = platform.path.join(
      tempDir,
      `script.${scriptExtension}`,
    );

    // Write script to temp file
    await platform.fs.writeTextFile(scriptPath, args.script);

    if (options?.signal?.aborted) {
      throw createAbortError("Shell script aborted");
    }

    const commandArgs = interpreter === "cmd"
      ? ["cmd.exe", "/c", scriptPath]
      : interpreter === "powershell"
      ? ["powershell", "-ExecutionPolicy", "Bypass", "-File", scriptPath]
      : [interpreter, scriptPath];

    // Execute script (run + drain streams for cancellation)
    const process = platform.command.run({
      cmd: commandArgs,
      cwd: workDir,
      stdout: "piped",
      stderr: "piped",
      stdin: "null",
    });

    const abortHandler = createProcessAbortHandler(process, platform.build.os);
    let aborted = false;
    const onAbort = (): void => {
      aborted = true;
      abortHandler.abort();
    };

    if (options?.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      const [stdoutBytes, stderrBytes, status] = await Promise.all([
        readProcessStream(process.stdout, options?.signal),
        readProcessStream(process.stderr, options?.signal),
        process.status,
      ]);

      if (aborted) {
        throw createAbortError("Shell script aborted");
      }

      const stdout = new TextDecoder().decode(stdoutBytes);
      const stderr = new TextDecoder().decode(stderrBytes);
      const message = status.code === 0
        ? `Script executed successfully`
        : `Script exited with code ${status.code}`;

      if (status.code === 0) {
        return okTool({
          stdout,
          stderr,
          exitCode: status.code,
          message,
        });
      }

      return failTool(message, {
        stdout,
        stderr,
        exitCode: status.code,
      });
    } finally {
      if (options?.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
      abortHandler.clear();
    }
  } catch (error) {
    const toolError = formatToolError("Failed to execute script", error);
    return failTool(toolError.message, {
      stdout: "",
      stderr: toolError.error,
      exitCode: 1,
    });
  } finally {
    // Cleanup temp directory
    if (tempDir) {
      try {
        await platform.fs.remove(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

function extractUrlsFromArgs(args: string[]): string[] {
  return args.flatMap(extractUrlsFromText);
}

function extractUrlsFromText(text: string): string[] {
  return text.match(/https?:\/\/[^\s"'`]+/g) ?? [];
}

// Process stream and abort helpers: see common/stream-utils.ts (SSOT)
import {
  createProcessAbortHandler,
  readProcessStream,
} from "../../../common/stream-utils.ts";

// ============================================================
// Tool Registry
// ============================================================

/**
 * All shell tools with metadata
 */
export const SHELL_TOOLS = {
  shell_exec: {
    fn: shellExec,
    description:
      "Execute shell command. ONLY use when no dedicated tool exists for the task.",
    category: "shell",
    safetyLevel: "L2",
    args: {
      command: "string - Shell command to execute",
      cwd: "string (optional) - Working directory (default: workspace root)",
      detach:
        "boolean (optional) - Launch without waiting for completion. Use for long-running OS automation tasks so the REPL is not blocked.",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      stdout: "string - Standard output",
      stderr: "string - Standard error",
      exitCode: "number - Process exit code",
      detached:
        "boolean - True when the command was launched in background mode",
      safetyLevel: "string - Applied safety level (L0/L1/L2)",
      message: "string - Human-readable result message",
    },
    safety:
      "L2 by default, L1 if in allow-list (git status/log/diff, deno test --dry-run)",
  },
  shell_script: {
    fn: shellScript,
    description:
      "Execute multi-line shell script. ONLY use when no dedicated tool exists for the task.",
    category: "shell",
    safetyLevel: "L2",
    args: {
      script: "string - Shell script content",
      interpreter:
        "string (optional) - 'bash', 'sh', 'cmd', or 'powershell' (default: sh or cmd on Windows)",
      cwd: "string (optional) - Working directory (default: workspace root)",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      stdout: "string - Standard output",
      stderr: "string - Standard error",
      exitCode: "number - Process exit code",
      message: "string - Human-readable result message",
    },
    safety: "L2 always (always confirm)",
  },
} as const;
