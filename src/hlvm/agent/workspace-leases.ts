import { getPlatform } from "../../platform/platform.ts";
import { readProcessStream } from "../../common/stream-utils.ts";
import { RuntimeError } from "../../common/error.ts";
import { copyDirectoryRecursive } from "../../common/fs-copy.ts";

export type WorkspaceLeaseKind = "temp_dir" | "git_worktree";

export type SandboxCapability = "basic" | "restricted" | "full";

export interface WorkspaceLease {
  path: string;
  kind: WorkspaceLeaseKind;
  sandboxCapability: SandboxCapability;
  cleanup: () => Promise<void>;
}

async function runGit(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const platform = getPlatform();
  const process = platform.command.run({
    cmd: ["git", ...args],
    cwd,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
  const [stdoutBytes, stderrBytes, status] = await Promise.all([
    readProcessStream(process.stdout),
    readProcessStream(process.stderr),
    process.status,
  ]);
  return {
    code: status.code,
    stdout: new TextDecoder().decode(stdoutBytes).trim(),
    stderr: new TextDecoder().decode(stderrBytes).trim(),
  };
}

async function resolveGitWorkspace(
  parentWorkspace: string,
): Promise<{ repoRoot: string; workspaceRelative: string; baseRevision?: string } | undefined> {
  const platform = getPlatform();
  const repoResult = await runGit(["rev-parse", "--show-toplevel"], parentWorkspace);
  if (repoResult.code !== 0 || !repoResult.stdout) {
    return undefined;
  }
  const repoRoot = platform.path.normalize(repoResult.stdout);
  // Use git's own idea of the current subpath to avoid path alias issues
  // like /var/... versus /private/var/... on macOS temp dirs.
  const prefixResult = await runGit(["rev-parse", "--show-prefix"], parentWorkspace);
  const workspaceRelative = prefixResult.code === 0
    ? prefixResult.stdout.replace(/[\\/]+$/, "") || "."
    : platform.path.relative(repoRoot, parentWorkspace);
  const revisionResult = await runGit(["rev-parse", "HEAD"], parentWorkspace);
  return {
    repoRoot,
    workspaceRelative,
    baseRevision: revisionResult.code === 0 && revisionResult.stdout
      ? revisionResult.stdout
      : undefined,
  };
}

async function createTempDirLease(
  parentWorkspace: string,
  threadId: string,
): Promise<WorkspaceLease> {
  const platform = getPlatform();
  const childDir = platform.path.join(
    parentWorkspace,
    `.hlvm-child-${threadId.slice(0, 8)}`,
  );
  await platform.fs.mkdir(childDir, { recursive: true });
  await copyDirectoryRecursive(parentWorkspace, childDir, {
    skip: (sourcePath, name) =>
      sourcePath === childDir ||
      sourcePath.startsWith(`${childDir}${platform.path.sep}`) ||
      name === ".git" ||
      name.startsWith(".hlvm-child-"),
  });
  return {
    path: childDir,
    kind: "temp_dir",
    sandboxCapability: "basic",
    cleanup: async () => {
      try {
        await platform.fs.remove(childDir, { recursive: true });
      } catch {
        // Best effort.
      }
    },
  };
}

async function createGitWorktreeLease(
  threadId: string,
  gitWorkspace: { repoRoot: string; workspaceRelative: string; baseRevision?: string },
): Promise<WorkspaceLease> {
  const platform = getPlatform();
  const worktreeRoot = await platform.fs.makeTempDir({
    prefix: `hlvm-worktree-${threadId.slice(0, 8)}-`,
  });
  const addResult = await runGit(
    ["worktree", "add", "--detach", worktreeRoot, gitWorkspace.baseRevision ?? "HEAD"],
    gitWorkspace.repoRoot,
  );
  if (addResult.code !== 0) {
    try {
      await platform.fs.remove(worktreeRoot, { recursive: true });
    } catch {
      // Best effort.
    }
    throw new RuntimeError(
      addResult.stderr || "git worktree add failed",
      { source: "workspace_lease" },
    );
  }
  const leasePath = gitWorkspace.workspaceRelative &&
      gitWorkspace.workspaceRelative !== "."
    ? platform.path.join(worktreeRoot, gitWorkspace.workspaceRelative)
    : worktreeRoot;
  return {
    path: leasePath,
    kind: "git_worktree",
    sandboxCapability: "restricted",
    cleanup: async () => {
      try {
        await runGit(["worktree", "remove", "--force", worktreeRoot], gitWorkspace.repoRoot);
      } catch {
        // Best effort.
      }
      try {
        await platform.fs.remove(worktreeRoot, { recursive: true });
      } catch {
        // Best effort.
      }
    },
  };
}

export async function createWorkspaceLease(
  parentWorkspace: string,
  threadId: string,
): Promise<WorkspaceLease> {
  try {
    const gitWorkspace = await resolveGitWorkspace(parentWorkspace);
    if (gitWorkspace) {
      return await createGitWorktreeLease(threadId, gitWorkspace);
    }
  } catch {
    // Fall back to temp-dir isolation.
  }
  return await createTempDirLease(parentWorkspace, threadId);
}
