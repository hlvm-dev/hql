/**
 * Shell Tools - SSOT-compliant shell execution for AI agents
 *
 * Provides 3 core shell operations with security:
 * 1. shell_exec - Execute shell command with allow-list checking
 * 2. shell_script - Execute multi-line shell script
 * 3. local_code_execute - Execute inline code through the shell-backed runtime
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
  isSafeCommand,
  parseShellCommand,
} from "../../../common/shell-parser.ts";
import { classifyShellPipeline } from "../security/shell-classifier.ts";
import type {
  ToolExecutionOptions,
  ToolTranscriptAdapter,
} from "../registry.ts";
import {
  failTool,
  failToolDetailed,
  formatToolError,
  okTool,
} from "../tool-results.ts";
import { truncate } from "../../../common/utils.ts";

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

/** Arguments for local_code_execute tool */
export interface LocalCodeExecuteArgs {
  code: string;
  language?: string;
  cwd?: string;
}

type LocalCodeLanguage =
  | "python"
  | "javascript"
  | "typescript"
  | "shell"
  | "powershell"
  | "cmd";

const SHELL_TRANSCRIPT_ADAPTER: ToolTranscriptAdapter = {
  displayName: "Bash",
  formatProgress: (event) => {
    const message = event.message.trim();
    if (message) return { message, tone: event.tone };
    if (event.phase === "start") {
      return { message: "Running...", tone: "running" };
    }
    return null;
  },
};

function normalizeLocalCodeLanguage(
  language?: string,
): LocalCodeLanguage {
  const normalized = language?.trim().toLowerCase();
  switch (normalized) {
    case undefined:
    case "":
    case "ts":
    case "typescript":
    case "deno":
      return "typescript";
    case "js":
    case "javascript":
    case "node":
    case "nodejs":
      return "javascript";
    case "py":
    case "python":
    case "python3":
      return "python";
    case "sh":
    case "bash":
    case "zsh":
    case "shell":
      return "shell";
    case "powershell":
    case "pwsh":
      return "powershell";
    case "cmd":
    case "batch":
      return "cmd";
    default:
      return "typescript";
  }
}

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function buildInlineCodeCommand(
  language: Exclude<LocalCodeLanguage, "shell" | "powershell" | "cmd">,
  code: string,
): string {
  switch (language) {
    case "python":
      return `python3 -c ${quoteShellArg(code)}`;
    case "javascript":
      return `node -e ${quoteShellArg(code)}`;
    case "typescript":
      return `deno eval ${quoteShellArg(code)}`;
  }
}

/**
 * Backward-compatible classifier returning only safety level.
 * Use classifyShellCommandWithReason for detailed reasons.
 */
export function classifyShellCommand(command: string): "L0" | "L1" | "L2" {
  return classifyShellPipeline(command).level;
}

const DETACHED_LAUNCH_GRACE_MS = 75;
const MAX_SHELL_PROGRESS_CHARS = 160;

function emitShellProgress(
  options: ToolExecutionOptions | undefined,
  message: string,
  phase: string,
  tone: "running" | "warning" = "running",
): void {
  const trimmed = message.trim();
  if (!trimmed) return;
  options?.onAgentEvent?.({
    type: "tool_progress",
    name: options?.toolName ?? "shell_exec",
    toolCallId: options?.toolCallId,
    argsSummary: options?.argsSummary ?? "",
    message: truncate(trimmed, MAX_SHELL_PROGRESS_CHARS),
    tone,
    phase,
  });
}

function createShellStreamProgressReporter(
  options: ToolExecutionOptions | undefined,
  streamName: "stdout" | "stderr",
): {
  onChunk: (chunk: Uint8Array) => void;
  flush: () => void;
} {
  const decoder = new TextDecoder();
  let buffer = "";
  let lastEmitted = "";

  const emitLine = (line: string): void => {
    const normalized = line.replace(/\s+/g, " ").trim();
    if (!normalized || normalized === lastEmitted) return;
    lastEmitted = normalized;
    emitShellProgress(
      options,
      streamName === "stderr" ? `stderr: ${normalized}` : normalized,
      streamName,
      streamName === "stderr" ? "warning" : "running",
    );
  };

  const drainBuffer = (): void => {
    const normalizedBuffer = buffer.replace(/\r/g, "\n");
    const parts = normalizedBuffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      emitLine(part);
    }
  };

  return {
    onChunk: (chunk: Uint8Array) => {
      buffer += decoder.decode(chunk, { stream: true });
      drainBuffer();
    },
    flush: () => {
      buffer += decoder.decode();
      drainBuffer();
      emitLine(buffer);
      buffer = "";
    },
  };
}

function isAbortLikeError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  return lower.includes("aborted") ||
    lower.includes("interrupted") ||
    lower.includes("cancelled") ||
    lower.includes("canceled");
}

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
  const safetyLevel = classifyShellCommand(args.command);
  try {
    const platform = getPlatform();

    // Validate working directory
    const workDir = args.cwd
      ? await resolveToolPath(args.cwd, workspace)
      : workspace;

    // Classify command for safety level
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

    // When pipes/redirects are present, run through shell interpreter instead of rejecting
    const useShellInterpreter = !isSafeCommand(parsedCommand);
    const cmdArgs = useShellInterpreter
      ? (platform.build.os === "windows"
        ? ["cmd.exe", "/c", args.command]
        : ["sh", "-c", args.command])
      : [parsedCommand.program, ...parsedCommand.args];
    const detach = args.detach === true ||
      shouldAutoDetachShellCommand(args.command, platform.build.os);


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

    const stdoutProgress = createShellStreamProgressReporter(
      options,
      "stdout",
    );
    const stderrProgress = createShellStreamProgressReporter(
      options,
      "stderr",
    );

    try {
      const [stdoutBytes, stderrBytes, status] = await Promise.all([
        readProcessStream(
          process.stdout,
          options?.signal,
          undefined,
          stdoutProgress.onChunk,
        ),
        readProcessStream(
          process.stderr,
          options?.signal,
          undefined,
          stderrProgress.onChunk,
        ),
        process.status,
      ]);
      stdoutProgress.flush();
      stderrProgress.flush();

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
      stdoutProgress.flush();
      stderrProgress.flush();
      if (options?.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
      abortHandler.clear();
    }
  } catch (error) {
    if (isAbortLikeError(error, options?.signal)) {
      return failToolDetailed(
        "Shell command aborted",
        { source: "runtime", kind: "interrupted", retryable: false },
        {
          stdout: "",
          stderr: "",
          exitCode: 1,
          safetyLevel,
        },
      );
    }
    const toolError = formatToolError("Failed to execute command", error);
    return failTool(toolError.message, {
      stdout: "",
      stderr: toolError.error,
      exitCode: 1,
      safetyLevel,
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
      ? await resolveToolPath(args.cwd, workspace)
      : workspace;

    const isWindows = platform.build.os === "windows";
    const interpreter = args.interpreter ||
      (isWindows ? "cmd" : "sh");

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

    const stdoutProgress = createShellStreamProgressReporter(
      options,
      "stdout",
    );
    const stderrProgress = createShellStreamProgressReporter(
      options,
      "stderr",
    );

    try {
      const [stdoutBytes, stderrBytes, status] = await Promise.all([
        readProcessStream(
          process.stdout,
          options?.signal,
          undefined,
          stdoutProgress.onChunk,
        ),
        readProcessStream(
          process.stderr,
          options?.signal,
          undefined,
          stderrProgress.onChunk,
        ),
        process.status,
      ]);
      stdoutProgress.flush();
      stderrProgress.flush();

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
      stdoutProgress.flush();
      stderrProgress.flush();
      if (options?.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
      abortHandler.clear();
    }
  } catch (error) {
    if (isAbortLikeError(error, options?.signal)) {
      return failToolDetailed(
        "Shell script aborted",
        { source: "runtime", kind: "interrupted", retryable: false },
        {
          stdout: "",
          stderr: "",
          exitCode: 1,
        },
      );
    }
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

/**
 * Execute inline code locally using the existing shell safety/execution path.
 *
 * Defaults to Deno/TypeScript for deterministic local computation, while still
 * allowing explicit Python, JavaScript, and shell-family execution.
 */
export async function localCodeExecute(
  args: LocalCodeExecuteArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<ShellExecResult | ShellScriptResult> {
  const language = normalizeLocalCodeLanguage(args.language);

  if (
    language === "shell" || language === "powershell" ||
    language === "cmd"
  ) {
    return shellScript({
      script: args.code,
      interpreter: language === "shell"
        ? "sh"
        : language,
      cwd: args.cwd,
    }, workspace, options);
  }

  return shellExec({
    command: buildInlineCodeCommand(language, args.code),
    cwd: args.cwd,
  }, workspace, options);
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
    transcript: SHELL_TRANSCRIPT_ADAPTER,
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
    transcript: SHELL_TRANSCRIPT_ADAPTER,
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
  local_code_execute: {
    fn: localCodeExecute,
    description:
      "Execute inline code locally through HLVM's shell-backed runtime. Prefer this over raw shell_exec for local code.exec tasks.",
    category: "shell",
    safetyLevel: "L2",
    args: {
      code: "string - Inline code to execute locally",
      language:
        "string (optional) - typescript/deno (default), javascript/node, python, shell, powershell, or cmd",
      cwd: "string (optional) - Working directory (default: workspace root)",
    },
    returns: {
      success: "boolean - Whether the execution succeeded",
      stdout: "string - Standard output",
      stderr: "string - Standard error",
      exitCode: "number - Process exit code",
      message: "string - Human-readable result message",
    },
    safety:
      "L2 always. Executes inline code locally via Deno/Node/Python or a shell interpreter.",
  },
} as const;
