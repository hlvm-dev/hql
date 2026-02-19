/**
 * Git Tools - SSOT-compliant git operations for AI agents
 *
 * Provides 4 core git operations:
 * 1. git_status - Get structured working tree status
 * 2. git_diff - Show changes between refs/staged/unstaged
 * 3. git_log - Show recent commit history as structured JSON
 * 4. git_commit - Stage files and commit (destructive → L2)
 *
 * All operations:
 * - Use platform abstraction (getPlatform)
 * - Use path sandboxing (resolveToolPath)
 * - Handle errors gracefully
 * - Return structured results
 */

import { getPlatform } from "../../../platform/platform.ts";
import { resolveToolPath } from "../path-utils.ts";
import type { ToolExecutionOptions } from "../registry.ts";
import { formatToolError, okTool, failTool } from "../tool-results.ts";
import { isPathWithinRoot } from "../security/path-sandbox.ts";
import { ValidationError } from "../../../common/error.ts";
import { readProcessStream } from "../../../common/stream-utils.ts";

// ============================================================
// Types
// ============================================================

/** Arguments for git_status tool */
export interface GitStatusArgs {
  path?: string;
}

/** A single file entry from git status */
interface StatusEntry {
  file: string;
  status: string;
  staged: boolean;
}

/** Arguments for git_diff tool */
export interface GitDiffArgs {
  path?: string;
  staged?: boolean;
  ref?: string;
}

/** Arguments for git_log tool */
export interface GitLogArgs {
  count?: number;
  path?: string;
  ref?: string;
}

/** A single commit entry from git log */
interface LogEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
}

/** Arguments for git_commit tool */
export interface GitCommitArgs {
  message: string;
  files?: string[];
  all?: boolean;
}

// ============================================================
// Helpers
// ============================================================

const PORCELAIN_STATUS: Record<string, string> = {
  "M": "modified",
  "A": "added",
  "D": "deleted",
  "R": "renamed",
  "C": "copied",
  "?": "untracked",
  "!": "ignored",
  "U": "unmerged",
};

async function runGit(
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const platform = getPlatform();
  const process = platform.command.run({
    cmd: ["git", ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
  });

  const [stdoutBytes, stderrBytes, status] = await Promise.all([
    readProcessStream(process.stdout),
    readProcessStream(process.stderr),
    process.status,
  ]);

  if (signal?.aborted) {
    const err = new Error("Git command aborted");
    err.name = "AbortError";
    throw err;
  }

  return {
    stdout: new TextDecoder().decode(stdoutBytes),
    stderr: new TextDecoder().decode(stderrBytes),
    code: status.code,
  };
}


async function resolveGitPathspec(
  inputPath: string,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<string> {
  const platform = getPlatform();
  const resolved = await resolveToolPath(inputPath, workspace, options?.policy ?? null);
  if (!isPathWithinRoot(resolved, workspace)) {
    throw new ValidationError(`Path is outside workspace: ${inputPath}`, "git_tool");
  }
  const relative = platform.path.relative(workspace, resolved) || ".";
  return relative.split(platform.path.sep).join("/");
}

function parseStatusLine(line: string): StatusEntry | null {
  if (line.length < 4) return null;

  const indexStatus = line[0];
  const workTreeStatus = line[1];
  const file = line.slice(3).trim();

  if (!file) return null;

  const staged = indexStatus !== " " && indexStatus !== "?";
  const statusCode = staged ? indexStatus : workTreeStatus;
  const status = PORCELAIN_STATUS[statusCode] ?? statusCode;

  return { file, status, staged };
}

// ============================================================
// Tool 1: git_status
// ============================================================

export async function gitStatus(
  args: GitStatusArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  try {
    const cwd = args.path
      ? await resolveToolPath(args.path, workspace, options?.policy ?? null)
      : workspace;

    const result = await runGit(
      ["status", "--porcelain=v1"],
      cwd,
      options?.signal,
    );

    if (result.code !== 0) {
      return failTool(`git status failed: ${result.stderr.trim()}`);
    }

    const entries: StatusEntry[] = [];
    for (const line of result.stdout.split("\n")) {
      if (!line.trim()) continue;
      const entry = parseStatusLine(line);
      if (entry) entries.push(entry);
    }

    const staged = entries.filter((e) => e.staged);
    const unstaged = entries.filter((e) => !e.staged && e.status !== "untracked");
    const untracked = entries.filter((e) => e.status === "untracked");

    return okTool({
      entries,
      staged: staged.map((e) => e.file),
      unstaged: unstaged.map((e) => e.file),
      untracked: untracked.map((e) => e.file),
      clean: entries.length === 0,
      message: entries.length === 0
        ? "Working tree clean"
        : `${entries.length} file(s) changed`,
    });
  } catch (error) {
    const { message } = formatToolError("Failed to get git status", error);
    return failTool(message);
  }
}

// ============================================================
// Tool 2: git_diff
// ============================================================

export async function gitDiff(
  args: GitDiffArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  try {
    const cwd = workspace;

    const gitArgs = ["diff"];
    if (args.staged) gitArgs.push("--staged");
    if (args.ref) gitArgs.push(args.ref);
    if (args.path) {
      const pathspec = await resolveGitPathspec(args.path, workspace, options);
      // Use -- to separate path from other args
      gitArgs.push("--", pathspec);
    }

    const result = await runGit(gitArgs, cwd, options?.signal);

    if (result.code !== 0) {
      return failTool(`git diff failed: ${result.stderr.trim()}`);
    }

    const diff = result.stdout;
    const fileCount = (diff.match(/^diff --git/gm) ?? []).length;

    return okTool({
      diff,
      fileCount,
      empty: diff.trim().length === 0,
      message: diff.trim().length === 0
        ? "No differences found"
        : `${fileCount} file(s) changed`,
    });
  } catch (error) {
    const { message } = formatToolError("Failed to get git diff", error);
    return failTool(message);
  }
}

// ============================================================
// Tool 3: git_log
// ============================================================

export async function gitLog(
  args: GitLogArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  try {
    const count = Math.min(args.count ?? 10, 100);

    const gitArgs = [
      "log",
      `--format=%H%n%an%n%aI%n%s%n---`,
      `-n`,
      String(count),
    ];
    if (args.ref) gitArgs.push(args.ref);
    if (args.path) {
      const pathspec = await resolveGitPathspec(args.path, workspace, options);
      gitArgs.push("--", pathspec);
    }

    const result = await runGit(gitArgs, workspace, options?.signal);

    if (result.code !== 0) {
      return failTool(`git log failed: ${result.stderr.trim()}`);
    }

    const entries: LogEntry[] = [];
    const blocks = result.stdout.split("---\n");

    for (const block of blocks) {
      const lines = block.trim().split("\n");
      if (lines.length < 4) continue;

      entries.push({
        hash: lines[0],
        author: lines[1],
        date: lines[2],
        message: lines.slice(3).join("\n"),
      });
    }

    return okTool({
      commits: entries,
      count: entries.length,
      message: `${entries.length} commit(s)`,
    });
  } catch (error) {
    const { message } = formatToolError("Failed to get git log", error);
    return failTool(message);
  }
}

// ============================================================
// Tool 4: git_commit
// ============================================================

export async function gitCommit(
  args: GitCommitArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  try {
    if (!args.message || args.message.trim().length === 0) {
      return failTool("Commit message is required");
    }
    if (args.all && args.files && args.files.length > 0) {
      return failTool("Use either 'files' or 'all', not both");
    }

    // Stage files
    if (args.files && args.files.length > 0) {
      const validatedFiles: string[] = [];
      for (const file of args.files) {
        if (typeof file !== "string" || file.trim().length === 0) {
          return failTool("All file paths must be non-empty strings");
        }
        const pathspec = await resolveGitPathspec(file, workspace, options);
        validatedFiles.push(pathspec);
      }
      const addResult = await runGit(
        ["add", ...validatedFiles],
        workspace,
        options?.signal,
      );
      if (addResult.code !== 0) {
        return failTool(`git add failed: ${addResult.stderr.trim()}`);
      }
    } else if (args.all) {
      const addResult = await runGit(
        ["add", "-A"],
        workspace,
        options?.signal,
      );
      if (addResult.code !== 0) {
        return failTool(`git add failed: ${addResult.stderr.trim()}`);
      }
    }

    // Commit
    const commitResult = await runGit(
      ["commit", "-m", args.message],
      workspace,
      options?.signal,
    );

    if (commitResult.code !== 0) {
      return failTool(`git commit failed: ${commitResult.stderr.trim()}`);
    }

    // Get the commit hash
    const hashResult = await runGit(
      ["rev-parse", "HEAD"],
      workspace,
      options?.signal,
    );

    const hash = hashResult.stdout.trim();

    return okTool({
      hash,
      message: `Committed: ${args.message}`,
    });
  } catch (error) {
    const { message } = formatToolError("Failed to commit", error);
    return failTool(message);
  }
}

// ============================================================
// Tool Registry
// ============================================================

export const GIT_TOOLS = {
  git_status: {
    fn: gitStatus,
    description: "Get git working tree status as structured data. Use this instead of shell_exec 'git status'.",
    category: "git",
    replaces: "git status",
    safetyLevel: "L0",
    args: {
      path: "string (optional) - Working directory (default: workspace root)",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      entries: "StatusEntry[] - All status entries",
      staged: "string[] - Staged file paths",
      unstaged: "string[] - Unstaged modified file paths",
      untracked: "string[] - Untracked file paths",
      clean: "boolean - True if working tree is clean",
      message: "string - Human-readable result message",
    },
  },
  git_diff: {
    fn: gitDiff,
    description: "Show git diff between refs, staged, or unstaged changes. Use this instead of shell_exec 'git diff'.",
    category: "git",
    replaces: "git diff",
    safetyLevel: "L0",
    args: {
      path: "string (optional) - File or directory to diff",
      staged: "boolean (optional) - Show staged changes only",
      ref: "string (optional) - Git ref to diff against (e.g., 'HEAD~1', 'main')",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      diff: "string - Raw diff output",
      fileCount: "number - Number of files changed",
      empty: "boolean - True if no differences",
      message: "string - Human-readable result message",
    },
  },
  git_log: {
    fn: gitLog,
    description: "Show recent git commit history as structured data. Use this instead of shell_exec 'git log'.",
    category: "git",
    replaces: "git log",
    safetyLevel: "L0",
    args: {
      count: "number (optional) - Number of commits to show (default: 10, max: 100)",
      path: "string (optional) - Filter commits by file path",
      ref: "string (optional) - Git ref to start from",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      commits: "LogEntry[] - Commit entries (hash, author, date, message)",
      count: "number - Number of commits returned",
      message: "string - Human-readable result message",
    },
  },
  git_commit: {
    fn: gitCommit,
    description: "Stage files and create a git commit",
    category: "git",
    safetyLevel: "L2",
    args: {
      message: "string - Commit message",
      files: "string[] (optional) - Files to stage before committing (cannot be used with all=true)",
      all: "boolean (optional) - Stage all changes (git add -A); cannot be used with files",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      hash: "string - Commit hash",
      message: "string - Human-readable result message",
    },
    safety: "L2 always (destructive — modifies git history)",
  },
} as const;
