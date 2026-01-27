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
 * Allow-list for L1 (confirm once) shell commands
 * Everything else defaults to L2 (always confirm)
 *
 * L1 commands are read-only and safe:
 * - git status: Show working tree status
 * - git log: Show commit history
 * - git diff: Show changes
 * - deno test --dry-run: Show tests without running
 */
export const SHELL_ALLOWLIST_L1 = [
  /^git\s+status$/,
  /^git\s+log/,               // Any git log args (read-only)
  /^git\s+diff/,              // Any git diff args (read-only)
  /^deno\s+test\s+.*--dry-run/,  // Must have --dry-run flag
];

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
  workspace: string
): Promise<ShellExecResult> {
  try {
    const platform = getPlatform();

    // Validate working directory
    const workDir = args.cwd
      ? await validatePath(args.cwd, workspace)
      : workspace;

    // Classify command for safety level
    const safetyLevel = classifyShellCommand(args.command);

    // Parse command into arguments
    // Simple split on spaces (doesn't handle complex quoting)
    const cmdArgs = args.command.trim().split(/\s+/);

    if (cmdArgs.length === 0) {
      return {
        success: false,
        message: "Empty command",
        stdout: "",
        stderr: "",
        exitCode: 1,
      };
    }

    // Execute using platform command API
    const result = await platform.command.output({
      cmd: cmdArgs,
      cwd: workDir,
    });

    return {
      success: result.code === 0,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
      exitCode: result.code,
      safetyLevel,
      message: result.code === 0
        ? `Command executed successfully`
        : `Command exited with code ${result.code}`,
    };
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
  workspace: string
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

    // Execute script
    const result = await platform.command.output({
      cmd: [interpreter, scriptPath],
      cwd: workDir,
    });

    return {
      success: result.code === 0,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
      exitCode: result.code,
      message: result.code === 0
        ? `Script executed successfully`
        : `Script exited with code ${result.code}`,
    };
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
