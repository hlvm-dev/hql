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
import { validatePath } from "../security/path-sandbox.ts";
import { parseShellCommand, isSafeCommand, getUnsafeReason } from "../../../common/shell-parser.ts";
import { SHELL_ALLOWLIST_L1 } from "../constants.ts";

// ============================================================
// Types
// ============================================================

/** Result of shell command execution */
export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Arguments for shell_exec tool */
export interface ShellExecArgs {
  command: string;
  cwd?: string;
}

/** Result of shell_exec operation */
export interface ShellExecResult extends ShellResult {
  success: boolean;
  message?: string;
  safetyLevel?: "L1" | "L2";
}

/** Arguments for shell_script tool */
export interface ShellScriptArgs {
  script: string;
  interpreter?: "bash" | "sh";
  cwd?: string;
}

/** Result of shell_script operation */
export interface ShellScriptResult extends ShellResult {
  success: boolean;
  message?: string;
}

// ============================================================
// Safety Configuration
// ============================================================

/**
 * Check if a command is in the L1 allow-list
 *
 * @param command Command string to check
 * @returns "L1" if allow-listed, "L2" otherwise
 */
export function classifyShellCommand(command: string): "L1" | "L2" {
  const trimmed = command.trim();

  for (const pattern of SHELL_ALLOWLIST_L1) {
    if (pattern.test(trimmed)) {
      return "L1";
    }
  }

  return "L2";
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
  options?: { signal?: AbortSignal },
): Promise<ShellExecResult> {
  try {
    const platform = getPlatform();

    // Validate working directory
    const workDir = args.cwd
      ? await validatePath(args.cwd, workspace)
      : workspace;

    // Classify command for safety level
    const safetyLevel = classifyShellCommand(args.command);

    // Parse command with proper quote/escape handling
    let parsedCommand;
    try {
      parsedCommand = parseShellCommand(args.command);
    } catch (error) {
      return {
        success: false,
        message: `Invalid shell command: ${
          error instanceof Error ? error.message : String(error)
        }`,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        safetyLevel,
      };
    }

    // Reject unsafe operators for shell_exec (use shell_script instead)
    if (!isSafeCommand(parsedCommand)) {
      return {
        success: false,
        message: `Unsafe shell command for shell_exec: ${getUnsafeReason(parsedCommand)}. Use shell_script for complex commands.`,
        stdout: "",
        stderr: getUnsafeReason(parsedCommand),
        exitCode: 1,
        safetyLevel,
      };
    }

    const cmdArgs = [parsedCommand.program, ...parsedCommand.args];

    if (options?.signal?.aborted) {
      const error = new Error("Shell command aborted");
      error.name = "AbortError";
      throw error;
    }

    // Execute using platform command API (run + drain streams for cancellation)
    const process = platform.command.run({
      cmd: cmdArgs,
      cwd: workDir,
      stdout: "piped",
      stderr: "piped",
      stdin: "null",
    });

    let aborted = false;
    const onAbort = (): void => {
      aborted = true;
      process.kill?.("SIGTERM");
    };

    if (options?.signal) {
      options.signal.addEventListener("abort", onAbort);
    }

    try {
      const [stdoutBytes, stderrBytes, status] = await Promise.all([
        readProcessStream(process.stdout, options?.signal),
        readProcessStream(process.stderr, options?.signal),
        process.status,
      ]);

      if (aborted) {
        const error = new Error("Shell command aborted");
        error.name = "AbortError";
        throw error;
      }

      return {
        success: status.code === 0,
        stdout: new TextDecoder().decode(stdoutBytes),
        stderr: new TextDecoder().decode(stderrBytes),
        exitCode: status.code,
        safetyLevel,
        message: status.code === 0
          ? `Command executed successfully`
          : `Command exited with code ${status.code}`,
      };
    } finally {
      if (options?.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
    }
  } catch (error) {
    return {
      success: false,
      message: `Failed to execute command: ${
        error instanceof Error ? error.message : String(error)
      }`,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 1,
    };
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
  options?: { signal?: AbortSignal },
): Promise<ShellScriptResult> {
  const platform = getPlatform();
  let tempDir: string | undefined;

  try {
    // Validate working directory
    const workDir = args.cwd
      ? await validatePath(args.cwd, workspace)
      : workspace;

    const interpreter = args.interpreter || "sh";

    // Create temp directory for script
    tempDir = await platform.fs.makeTempDir({ prefix: "hlvm-shell-" });
    const scriptPath = platform.path.join(tempDir, "script.sh");

    // Write script to temp file
    await platform.fs.writeTextFile(scriptPath, args.script);

    if (options?.signal?.aborted) {
      const error = new Error("Shell script aborted");
      error.name = "AbortError";
      throw error;
    }

    // Execute script (run + drain streams for cancellation)
    const process = platform.command.run({
      cmd: [interpreter, scriptPath],
      cwd: workDir,
      stdout: "piped",
      stderr: "piped",
      stdin: "null",
    });

    let aborted = false;
    const onAbort = (): void => {
      aborted = true;
      process.kill?.("SIGTERM");
    };

    if (options?.signal) {
      options.signal.addEventListener("abort", onAbort);
    }

    try {
      const [stdoutBytes, stderrBytes, status] = await Promise.all([
        readProcessStream(process.stdout, options?.signal),
        readProcessStream(process.stderr, options?.signal),
        process.status,
      ]);

      if (aborted) {
        const error = new Error("Shell script aborted");
        error.name = "AbortError";
        throw error;
      }

      return {
        success: status.code === 0,
        stdout: new TextDecoder().decode(stdoutBytes),
        stderr: new TextDecoder().decode(stderrBytes),
        exitCode: status.code,
        message: status.code === 0
          ? `Script executed successfully`
          : `Script exited with code ${status.code}`,
      };
    } finally {
      if (options?.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
    }
  } catch (error) {
    return {
      success: false,
      message: `Failed to execute script: ${
        error instanceof Error ? error.message : String(error)
      }`,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 1,
    };
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

// ============================================================
// Helpers
// ============================================================

async function readProcessStream(
  stream: unknown,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!stream || typeof (stream as ReadableStream<Uint8Array>).getReader !== "function") {
    return new Uint8Array();
  }

  const reader = (stream as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];

  const onAbort = (): void => {
    reader.cancel().catch(() => {});
  };

  if (signal) {
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort);
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
    reader.releaseLock();
  }

  return concatUint8Arrays(chunks);
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array();
  if (chunks.length === 1) return chunks[0];

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

// ============================================================
// Tool Registry
// ============================================================

/**
 * All shell tools with metadata
 */
export const SHELL_TOOLS = {
  shell_exec: {
    fn: shellExec,
    description: "Execute shell command",
    args: {
      command: "string - Shell command to execute",
      cwd: "string (optional) - Working directory (default: workspace root)",
    },
    safety: "L2 by default, L1 if in allow-list (git status/log/diff, deno test --dry-run)",
  },
  shell_script: {
    fn: shellScript,
    description: "Execute multi-line shell script",
    args: {
      script: "string - Shell script content",
      interpreter: "string (optional) - 'bash' or 'sh' (default: sh)",
      cwd: "string (optional) - Working directory (default: workspace root)",
    },
    safety: "L2 always (always confirm)",
  },
} as const;
