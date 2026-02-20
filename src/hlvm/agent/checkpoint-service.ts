/**
 * Shadow-Repo Checkpoint Service
 *
 * Follows the Gemini CLI pattern: a shadow git repo at
 * ~/.hlvm/checkpoints/<sha256(workspace)>/ with GIT_DIR + GIT_WORK_TREE
 * env vars pointing at the real project. Checkpoints are created before
 * agent mutations and restored via /undo.
 *
 * Known Gemini CLI bugs fixed:
 * 1. Always exclude .git in shadow gitignore (prevents 3.8GB growth)
 * 2. git init without --initial-branch (git < 2.28 compat)
 * 3. --no-verify on all shadow commits (pre-commit hook conflicts)
 * 4. Per-command env vars only, never global GIT_DIR
 *
 * Non-blocking: all errors caught and logged. Never throws. Never breaks
 * agent execution.
 */

import { getPlatform } from "../../platform/platform.ts";
import { getCheckpointsDir } from "../../common/paths.ts";
import { readProcessStream } from "../../common/stream-utils.ts";
import { getAgentLogger } from "./logger.ts";

// ============================================================
// Internal Helpers
// ============================================================

/** SHA-256 hex digest of an absolute workspace path (same as Gemini CLI). */
async function hashWorkspace(workspace: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(workspace);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Get the shadow git directory path for a workspace. */
async function getShadowGitDir(workspace: string): Promise<string> {
  const hash = await hashWorkspace(workspace);
  return getPlatform().path.join(getCheckpointsDir(), hash);
}

/** Run a git command with GIT_DIR and GIT_WORK_TREE env vars. */
async function runShadowGit(
  args: string[],
  shadowGitDir: string,
  workTree: string,
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const platform = getPlatform();
  const proc = platform.command.run({
    cmd: ["git", ...args],
    cwd: workTree,
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
    env: {
      GIT_DIR: shadowGitDir,
      GIT_WORK_TREE: workTree,
    },
  });

  const [stdoutBytes, stderrBytes, status] = await Promise.all([
    readProcessStream(proc.stdout, signal),
    readProcessStream(proc.stderr, signal),
    proc.status,
  ]);

  const decoder = new TextDecoder();
  return {
    code: status.code ?? 1,
    stdout: decoder.decode(stdoutBytes).trim(),
    stderr: decoder.decode(stderrBytes).trim(),
  };
}

/** Check if workspace is a git repo (has .git directory). */
async function isGitRepo(workspace: string): Promise<boolean> {
  const platform = getPlatform();
  try {
    const proc = platform.command.run({
      cmd: ["git", "rev-parse", "--git-dir"],
      cwd: workspace,
      stdout: "piped",
      stderr: "piped",
      stdin: "null",
    });
    const [, , status] = await Promise.all([
      readProcessStream(proc.stdout),
      readProcessStream(proc.stderr),
      proc.status,
    ]);
    return status.code === 0;
  } catch {
    return false;
  }
}

function normalizeIgnoreLine(line: string): string {
  return line.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function hasIgnorePattern(lines: string[], pattern: string): boolean {
  const normalizedPattern = normalizeIgnoreLine(pattern);
  return lines.some((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
      return false;
    }
    const normalizedLine = normalizeIgnoreLine(trimmed);
    return normalizedLine === normalizedPattern ||
      normalizedLine === `/${normalizedPattern}`;
  });
}

function toWorkspaceRelativePath(
  targetPath: string,
  workspace: string,
): string | null {
  const platform = getPlatform();
  const relative = platform.path.relative(workspace, targetPath);
  if (!relative || relative === ".") {
    return ".";
  }
  if (relative.startsWith("..") || platform.path.isAbsolute(relative)) {
    return null;
  }
  return relative.split(platform.path.sep).join("/");
}

/**
 * Ensure shadow repo exists and is properly configured.
 * Copies .gitignore from workspace + always adds .git exclusion.
 */
async function ensureShadowRepo(
  workspace: string,
  signal?: AbortSignal,
): Promise<string> {
  const platform = getPlatform();
  const shadowGitDir = await getShadowGitDir(workspace);

  // Create shadow git dir
  await platform.fs.mkdir(shadowGitDir, { recursive: true });

  // Check if already initialized (HEAD file exists)
  const headPath = platform.path.join(shadowGitDir, "HEAD");
  let needsInit = true;
  try {
    await platform.fs.stat(headPath);
    needsInit = false;
  } catch {
    // HEAD doesn't exist, needs init
  }

  if (needsInit) {
    // git init --bare <path> — must pass path as argument, not via GIT_DIR
    const proc = platform.command.run({
      cmd: ["git", "init", "--bare", shadowGitDir],
      cwd: workspace,
      stdout: "piped",
      stderr: "piped",
      stdin: "null",
    });
    const [, stderrBytes, status] = await Promise.all([
      readProcessStream(proc.stdout, signal),
      readProcessStream(proc.stderr, signal),
      proc.status,
    ]);
    if (status.code !== 0) {
      const stderr = new TextDecoder().decode(stderrBytes).trim();
      throw new Error(`Shadow repo init failed: ${stderr}`);
    }
  }

  // Build gitignore: start with workspace .gitignore, always add .git
  const ignoreLines: string[] = [];

  // Copy workspace .gitignore if it exists
  const workspaceIgnorePath = platform.path.join(workspace, ".gitignore");
  try {
    const content = await platform.fs.readTextFile(workspaceIgnorePath);
    ignoreLines.push(...content.split(/\r?\n/));
  } catch {
    // No .gitignore in workspace — that's fine
  }

  // Bug fix #1: Always exclude .git directory (Gemini CLI's #1 bug)
  const hasGitExclusion = hasIgnorePattern(ignoreLines, ".git") ||
    hasIgnorePattern(ignoreLines, "**/.git");
  if (!hasGitExclusion) {
    ignoreLines.push(".git");
  }

  // If HLVM state lives inside workspace, exclude checkpoints to avoid
  // self-snapshot recursion and repo bloat.
  const relativeCheckpointsDir = toWorkspaceRelativePath(
    getCheckpointsDir(),
    workspace,
  );
  if (
    relativeCheckpointsDir &&
    relativeCheckpointsDir !== "." &&
    !hasIgnorePattern(ignoreLines, relativeCheckpointsDir)
  ) {
    ignoreLines.push(`${relativeCheckpointsDir}/`);
  }

  // Write shadow gitignore inside the shadow git dir's info/ directory
  const infoDir = platform.path.join(shadowGitDir, "info");
  await platform.fs.mkdir(infoDir, { recursive: true });
  const excludePath = platform.path.join(infoDir, "exclude");
  await platform.fs.writeTextFile(excludePath, ignoreLines.join("\n") + "\n");

  return shadowGitDir;
}

// ============================================================
// Public API
// ============================================================

/**
 * Create a snapshot of workspace. Returns commit hash or null (non-blocking).
 */
export async function createCheckpoint(
  workspace: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const logger = getAgentLogger();
  try {
    if (!await isGitRepo(workspace)) {
      logger.debug("Checkpoint skipped: not a git repo");
      return null;
    }

    const shadowGitDir = await ensureShadowRepo(workspace, signal);

    // Stage all files
    const addResult = await runShadowGit(
      ["add", "-A"],
      shadowGitDir,
      workspace,
      signal,
    );
    if (addResult.code !== 0) {
      logger.debug(`Checkpoint add failed: ${addResult.stderr}`);
      return null;
    }

    // Check if there are changes to commit
    const diffResult = await runShadowGit(
      ["diff", "--cached", "--quiet"],
      shadowGitDir,
      workspace,
      signal,
    );
    if (diffResult.code === 0) {
      // No changes — return existing HEAD
      const headResult = await runShadowGit(
        ["rev-parse", "HEAD"],
        shadowGitDir,
        workspace,
        signal,
      );
      if (headResult.code === 0 && headResult.stdout) {
        logger.debug(
          `Checkpoint clean: ${headResult.stdout.slice(0, 8)}`,
        );
        return headResult.stdout;
      }
      // No HEAD yet (empty repo, first commit) — continue to commit
    }

    // Commit with --no-verify (bug fix #3: skip pre-commit hooks)
    const commitResult = await runShadowGit(
      [
        "commit",
        "--no-verify",
        "-m",
        `checkpoint ${new Date().toISOString()}`,
        "--allow-empty",
      ],
      shadowGitDir,
      workspace,
      signal,
    );
    if (commitResult.code !== 0) {
      logger.debug(`Checkpoint commit failed: ${commitResult.stderr}`);
      return null;
    }

    // Get commit hash
    const hashResult = await runShadowGit(
      ["rev-parse", "HEAD"],
      shadowGitDir,
      workspace,
      signal,
    );
    if (hashResult.code === 0 && hashResult.stdout) {
      logger.debug(`Checkpoint created: ${hashResult.stdout.slice(0, 8)}`);
      return hashResult.stdout;
    }

    return null;
  } catch (err) {
    logger.debug(`Checkpoint error: ${err}`);
    return null;
  }
}

/**
 * Restore workspace to last checkpoint. Returns success/error.
 */
export async function restoreCheckpoint(
  workspace: string,
  signal?: AbortSignal,
): Promise<{ restored: boolean; hash?: string; error?: string }> {
  const logger = getAgentLogger();
  try {
    if (!await isGitRepo(workspace)) {
      return { restored: false, error: "not a git repo" };
    }

    const shadowGitDir = await getShadowGitDir(workspace);

    // Get current HEAD
    const headResult = await runShadowGit(
      ["rev-parse", "HEAD"],
      shadowGitDir,
      workspace,
      signal,
    );
    if (headResult.code !== 0) {
      return { restored: false, error: "no checkpoint found" };
    }

    const hash = headResult.stdout;

    // Restore files from checkpoint
    const restoreResult = await runShadowGit(
      ["restore", "--source", hash, "--", "."],
      shadowGitDir,
      workspace,
      signal,
    );
    if (restoreResult.code !== 0) {
      return { restored: false, error: restoreResult.stderr };
    }

    // Clean untracked files that weren't in the checkpoint
    const cleanResult = await runShadowGit(
      ["clean", "-fd"],
      shadowGitDir,
      workspace,
      signal,
    );
    if (cleanResult.code !== 0) {
      logger.debug(`Checkpoint clean warning: ${cleanResult.stderr}`);
      // Non-fatal — restore already succeeded
    }

    logger.debug(`Checkpoint restored: ${hash.slice(0, 8)}`);
    return { restored: true, hash };
  } catch (err) {
    return { restored: false, error: String(err) };
  }
}

/**
 * Check if checkpoint exists for workspace.
 */
export async function hasCheckpoint(workspace: string): Promise<boolean> {
  try {
    const shadowGitDir = await getShadowGitDir(workspace);
    const headPath = getPlatform().path.join(shadowGitDir, "HEAD");
    await getPlatform().fs.stat(headPath);

    // Also verify there's at least one commit
    const result = await runShadowGit(
      ["rev-parse", "HEAD"],
      shadowGitDir,
      workspace,
    );
    return result.code === 0;
  } catch {
    return false;
  }
}

// Exported for testing
export { hashWorkspace as _hashWorkspace, isGitRepo as _isGitRepo };
