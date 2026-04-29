// Spawns a `git worktree` so an agent can run in an isolated copy of the repo
// under ~/.hlvm/worktrees/{repo-id}/{slug}. Worktrees with no changes are
// removed on completion; dirty worktrees are kept so the user can inspect them.

import { getPlatform } from "../../../platform/platform.ts";
import { getAgentLogger } from "../logger.ts";
import { TOOL_CATEGORY, ToolError } from "../error-taxonomy.ts";
import { TOOL_NAMES } from "../tool-names.ts";
import { getWorktreePath, getWorktreesDir } from "../../../common/paths.ts";

const log = getAgentLogger();

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

// "user/feature" → "user+feature" so the slug never introduces a nested directory.
function flattenSlug(slug: string): string {
  return slug.replaceAll("/", "+");
}

function worktreePathFor(gitRoot: string, slug: string): string {
  return getWorktreePath(gitRoot, flattenSlug(slug));
}

function worktreeBranchName(slug: string): string {
  return `worktree-${flattenSlug(slug)}`;
}

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

  // Fast-resume an existing worktree (e.g. crash recovery) by checking for HEAD before creating.
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

/** Returns true when the worktree has any uncommitted changes or new commits beyond `headCommit`. */
export async function hasWorktreeChanges(
  worktreePath: string,
  headCommit: string,
): Promise<boolean> {
  const status = await runGit(["status", "--porcelain"], worktreePath);
  // On error, assume changed so we never delete user work by accident.
  if (!status.success || status.stdout.length > 0) return true;

  const revList = await runGit(
    ["rev-list", "--count", `${headCommit}..HEAD`],
    worktreePath,
  );
  if (!revList.success) return true;
  return parseInt(revList.stdout, 10) > 0;
}

export async function removeAgentWorktree(
  worktreePath: string,
  worktreeBranch?: string,
  gitRoot?: string,
): Promise<boolean> {
  if (!gitRoot) {
    log.error("Cannot remove worktree: no gitRoot");
    return false;
  }

  const removeResult = await runGit(
    ["worktree", "remove", "--force", worktreePath],
    gitRoot,
  );
  if (!removeResult.success) {
    log.error(`Failed to remove worktree: ${removeResult.stderr}`);
    return false;
  }

  if (worktreeBranch) {
    await runGit(["branch", "-D", worktreeBranch], gitRoot);
  }

  log.debug(`Removed agent worktree: ${worktreePath}`);
  return true;
}

/** Idempotent cleanup: removes the worktree if it's clean, keeps it if it has any changes. */
export async function cleanupWorktree(
  info: WorktreeInfo | null,
): Promise<WorktreeResult> {
  if (!info) return {};
  const { worktreePath, worktreeBranch, headCommit, gitRoot } = info;
  // Without a baseline HEAD we can't detect changes, so keep the worktree.
  if (!headCommit) return { worktreePath, worktreeBranch };

  if (!await hasWorktreeChanges(worktreePath, headCommit)) {
    await removeAgentWorktree(worktreePath, worktreeBranch, gitRoot);
    return {};
  }

  log.debug(`Agent worktree has changes, keeping: ${worktreePath}`);
  return { worktreePath, worktreeBranch };
}
