/**
 * Agent Worktree Isolation
 *
 * CC source: utils/worktree.ts
 * Creates isolated git worktrees for agent execution.
 *
 * Flow (CC-faithful):
 * 1. Find git root
 * 2. Create worktree under ~/.hlvm/worktrees/{repo-id}/{slug}
 * 3. Agent works in isolated copy
 * 4. On completion: check for changes
 *    - No changes → remove worktree
 *    - Has changes → keep worktree, return path+branch
 */

import { getPlatform } from "../../../platform/platform.ts";
import { getAgentLogger } from "../logger.ts";
import { TOOL_CATEGORY, ToolError } from "../error-taxonomy.ts";
import { TOOL_NAMES } from "../tool-names.ts";
import { getWorktreePath, getWorktreesDir } from "../../../common/paths.ts";

const log = getAgentLogger();

// ============================================================
// Types
// ============================================================

export interface WorktreeInfo {
  worktreePath: string;
  worktreeBranch?: string;
  headCommit?: string;
  gitRoot?: string;
}

export interface WorktreeResult {
  worktreePath?: string;
  worktreeBranch?: string;
}

// ============================================================
// Path Helpers (CC: flattenSlug, worktreePathFor, worktreeBranchName)
// ============================================================

/**
 * Flatten slug to prevent nested directory issues.
 * CC: "user/feature" → "user+feature"
 */
function flattenSlug(slug: string): string {
  return slug.replaceAll("/", "+");
}

/**
 * Worktree path for a given slug.
 * HLVM: ~/.hlvm/worktrees/{repo-id}/{flatSlug}
 */
function worktreePathFor(gitRoot: string, slug: string): string {
  return getWorktreePath(gitRoot, flattenSlug(slug));
}

/**
 * Branch name for a worktree.
 * CC: worktree-{flatSlug}
 */
function worktreeBranchName(slug: string): string {
  return `worktree-${flattenSlug(slug)}`;
}

// ============================================================
// Git Helpers
// ============================================================

const textDecoder = new TextDecoder();

async function runGit(
  args: string[],
  cwd: string,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const platform = getPlatform();
  try {
    const result = await platform.command.output({
      cmd: ["git", ...args],
      cwd,
      stdout: "piped",
      stderr: "piped",
    });
    return {
      success: result.code === 0,
      stdout: textDecoder.decode(result.stdout).trim(),
      stderr: textDecoder.decode(result.stderr).trim(),
    };
  } catch (err) {
    return {
      success: false,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
}

async function findGitRoot(cwd: string): Promise<string | null> {
  const result = await runGit(["rev-parse", "--show-toplevel"], cwd);
  return result.success ? result.stdout : null;
}

async function getHeadSha(cwd: string): Promise<string | null> {
  const result = await runGit(["rev-parse", "HEAD"], cwd);
  return result.success ? result.stdout : null;
}

// ============================================================
// createAgentWorktree (CC: createAgentWorktree + getOrCreateWorktree)
// ============================================================

/**
 * Create an isolated git worktree for an agent.
 * CC-faithful implementation — simplified (no hooks, no sparse-checkout).
 *
 * Algorithm:
 * 1. Find git root
 * 2. Create ~/.hlvm/worktrees/{repo-id}/ dir
 * 3. Get HEAD commit for later change detection
 * 4. Create worktree with `git worktree add`
 * 5. Return worktree info
 */
export async function createAgentWorktree(
  slug: string,
  cwd: string,
): Promise<WorktreeInfo> {
  // Validate slug (CC: validateWorktreeSlug)
  // Each segment must match /^[a-zA-Z0-9._-]+$/ and reject "." and ".." segments
  if (!slug || slug.length > 64) {
    throw new ToolError(
      `Invalid worktree slug: '${slug}'`,
      TOOL_NAMES.AGENT_WORKTREE,
      TOOL_CATEGORY.VALIDATION,
    );
  }
  const segments = slug.split("/");
  for (const seg of segments) {
    if (!seg || seg === "." || seg === ".." || !/^[a-zA-Z0-9._-]+$/.test(seg)) {
      throw new ToolError(
        `Invalid worktree slug: '${slug}'`,
        "agent_worktree",
        "validation",
      );
    }
  }

  // Find git root (CC: findCanonicalGitRoot)
  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    throw new ToolError(
      "Cannot create worktree: not a git repository",
      TOOL_NAMES.AGENT_WORKTREE,
      TOOL_CATEGORY.VALIDATION,
    );
  }

  const worktreePath = worktreePathFor(gitRoot, slug);
  const branchName = worktreeBranchName(slug);

  // Fast-resume: check if worktree already exists (CC: readWorktreeHeadSha)
  const existingHead = await getHeadSha(worktreePath);
  if (existingHead) {
    log.debug(`Resuming existing worktree: ${worktreePath}`);
    return {
      worktreePath,
      worktreeBranch: branchName,
      headCommit: existingHead,
      gitRoot,
    };
  }

  // Create worktrees directory
  const platform = getPlatform();
  await platform.fs.mkdir(getWorktreesDir(gitRoot), { recursive: true });

  // Get current HEAD for change detection
  const headCommit = await getHeadSha(gitRoot);
  if (!headCommit) {
    throw new ToolError(
      "Cannot determine HEAD commit",
      TOOL_NAMES.AGENT_WORKTREE,
      TOOL_CATEGORY.INTERNAL,
    );
  }

  // Create worktree (CC: git worktree add -B branchName worktreePath HEAD)
  const result = await runGit(
    ["worktree", "add", "-B", branchName, worktreePath, "HEAD"],
    gitRoot,
  );

  if (!result.success) {
    throw new ToolError(
      `Failed to create worktree: ${result.stderr}`,
      TOOL_NAMES.AGENT_WORKTREE,
      TOOL_CATEGORY.INTERNAL,
    );
  }

  log.debug(`Created agent worktree: ${worktreePath} (branch: ${branchName})`);

  return {
    worktreePath,
    worktreeBranch: branchName,
    headCommit,
    gitRoot,
  };
}

// ============================================================
// hasWorktreeChanges (CC: hasWorktreeChanges)
// ============================================================

/**
 * Check if a worktree has any changes (uncommitted or new commits).
 * CC-faithful: both `git status` AND `git rev-list` must be clean.
 *
 * Returns true if there are ANY changes. False only if completely clean.
 */
export async function hasWorktreeChanges(
  worktreePath: string,
  headCommit: string,
): Promise<boolean> {
  // Check 1: uncommitted changes
  const status = await runGit(["status", "--porcelain"], worktreePath);
  if (!status.success || status.stdout.length > 0) {
    return true; // Has uncommitted changes (or error → assume changed)
  }

  // Check 2: new commits since creation
  const revList = await runGit(
    ["rev-list", "--count", `${headCommit}..HEAD`],
    worktreePath,
  );
  if (!revList.success) {
    return true; // Error → assume changed
  }
  const count = parseInt(revList.stdout, 10);
  return count > 0;
}

// ============================================================
// removeAgentWorktree (CC: removeAgentWorktree)
// ============================================================

/**
 * Remove an agent worktree and its branch.
 * CC-faithful: `git worktree remove --force` then `git branch -D`.
 */
export async function removeAgentWorktree(
  worktreePath: string,
  worktreeBranch?: string,
  gitRoot?: string,
): Promise<boolean> {
  if (!gitRoot) {
    log.error("Cannot remove worktree: no gitRoot");
    return false;
  }

  // Remove worktree (from main repo, not the worktree itself)
  const removeResult = await runGit(
    ["worktree", "remove", "--force", worktreePath],
    gitRoot,
  );
  if (!removeResult.success) {
    log.error(`Failed to remove worktree: ${removeResult.stderr}`);
    return false;
  }

  // Delete temporary branch (non-fatal)
  if (worktreeBranch) {
    await runGit(["branch", "-D", worktreeBranch], gitRoot);
  }

  log.debug(`Removed agent worktree: ${worktreePath}`);
  return true;
}

// ============================================================
// cleanupWorktreeIfNeeded (CC: cleanupWorktreeIfNeeded)
// ============================================================

/**
 * Cleanup helper — idempotent.
 * CC-faithful: check for changes → remove if clean, keep if dirty.
 */
export async function cleanupWorktree(
  info: WorktreeInfo | null,
): Promise<WorktreeResult> {
  if (!info) return {};

  const { worktreePath, worktreeBranch, headCommit, gitRoot } = info;

  if (!headCommit) {
    // Can't detect changes without headCommit — keep it
    return { worktreePath, worktreeBranch };
  }

  const changed = await hasWorktreeChanges(worktreePath, headCommit);
  if (!changed) {
    // Clean — remove worktree
    await removeAgentWorktree(worktreePath, worktreeBranch, gitRoot);
    return {};
  }

  // Has changes — keep
  log.debug(`Agent worktree has changes, keeping: ${worktreePath}`);
  return { worktreePath, worktreeBranch };
}
