/**
 * Agent Worktree Isolation Tests
 *
 * Tests CC-faithful worktree isolation:
 * - createAgentWorktree: creates isolated git worktree
 * - hasWorktreeChanges: detects uncommitted/committed changes
 * - removeAgentWorktree: cleans up worktree + branch
 * - cleanupWorktree: conditional cleanup (keep if changed, remove if clean)
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { getHlvmDir } from "../../../src/common/paths.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempHlvmDir } from "../helpers.ts";
import {
  cleanupWorktree,
  createAgentWorktree,
  hasWorktreeChanges,
  removeAgentWorktree,
} from "../../../src/hlvm/agent/tools/agent-worktree.ts";

const platform = getPlatform();
const TEST_BASE = "/tmp/hlvm-test-worktree";

async function ensureDir(path: string): Promise<void> {
  try {
    await platform.fs.mkdir(path, { recursive: true });
  } catch { /* exists */ }
}

async function cleanDir(path: string): Promise<void> {
  try {
    await platform.fs.remove(path, { recursive: true });
  } catch { /* doesn't exist */ }
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const result = await platform.command.output({
    cmd: ["git", ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  return new TextDecoder().decode(result.stdout).trim();
}

/** Create a temporary git repo for testing */
async function createTestRepo(): Promise<string> {
  const repoPath = `${TEST_BASE}/repo-${Date.now()}`;
  await ensureDir(repoPath);
  await runGit(["init"], repoPath);
  await runGit(["config", "user.email", "test@test.com"], repoPath);
  await runGit(["config", "user.name", "Test"], repoPath);
  await platform.fs.writeTextFile(`${repoPath}/README.md`, "# Test Repo\n");
  await runGit(["add", "README.md"], repoPath);
  await runGit(["commit", "-m", "initial"], repoPath);
  return repoPath;
}

// ============================================================
// createAgentWorktree
// ============================================================

Deno.test({
  name: "worktree: creates worktree in global HLVM worktrees",
  async fn() {
    await withTempHlvmDir(async () => {
      const repo = await createTestRepo();
      try {
        const info = await createAgentWorktree("test-agent", repo);

        assertExists(info.worktreePath);
        assertStringIncludes(info.worktreePath, `${getHlvmDir()}/worktrees/`);
        assertExists(info.worktreeBranch);
        assertExists(info.headCommit);
        assertExists(info.gitRoot);

        // Verify worktree directory exists
        const stat = await platform.fs.stat(info.worktreePath);
        assertEquals(stat.isDirectory, true);

        // Verify README.md is in worktree
        const readme = await platform.fs.readTextFile(
          `${info.worktreePath}/README.md`,
        );
        assertStringIncludes(readme, "Test Repo");

        // Cleanup
        await removeAgentWorktree(
          info.worktreePath,
          info.worktreeBranch,
          info.gitRoot,
        );
      } finally {
        await cleanDir(repo);
      }
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "worktree: rejects invalid slug",
  async fn() {
    await withTempHlvmDir(async () => {
      // Need a real git repo so slug validation runs before git root check
      const repo = await createTestRepo();
      try {
        await assertRejects(
          () => createAgentWorktree("../../../etc/passwd", repo),
          Error,
          "Invalid worktree slug",
        );
      } finally {
        await cleanDir(repo);
      }
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "worktree: fails on non-git directory",
  async fn() {
    await withTempHlvmDir(async () => {
      const nonGitDir = `${TEST_BASE}/non-git-${Date.now()}`;
      await ensureDir(nonGitDir);
      try {
        await assertRejects(
          () => createAgentWorktree("test", nonGitDir),
          Error,
          "not a git repository",
        );
      } finally {
        await cleanDir(nonGitDir);
      }
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "worktree: resumes existing worktree",
  async fn() {
    await withTempHlvmDir(async () => {
      const repo = await createTestRepo();
      try {
        const info1 = await createAgentWorktree("resume-test", repo);
        const info2 = await createAgentWorktree("resume-test", repo);

        // Should reuse same path
        assertEquals(info1.worktreePath, info2.worktreePath);
        assertExists(info2.headCommit);

        await removeAgentWorktree(
          info1.worktreePath,
          info1.worktreeBranch,
          info1.gitRoot,
        );
      } finally {
        await cleanDir(repo);
      }
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================
// hasWorktreeChanges
// ============================================================

Deno.test({
  name: "worktree: hasChanges returns false for clean worktree",
  async fn() {
    await withTempHlvmDir(async () => {
      const repo = await createTestRepo();
      try {
        const info = await createAgentWorktree("clean-test", repo);
        const changed = await hasWorktreeChanges(
          info.worktreePath,
          info.headCommit!,
        );
        assertEquals(changed, false);

        await removeAgentWorktree(
          info.worktreePath,
          info.worktreeBranch,
          info.gitRoot,
        );
      } finally {
        await cleanDir(repo);
      }
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "worktree: hasChanges returns true for uncommitted changes",
  async fn() {
    await withTempHlvmDir(async () => {
      const repo = await createTestRepo();
      try {
        const info = await createAgentWorktree("dirty-test", repo);

        // Make an uncommitted change in worktree
        await platform.fs.writeTextFile(
          `${info.worktreePath}/new-file.txt`,
          "agent wrote this",
        );

        const changed = await hasWorktreeChanges(
          info.worktreePath,
          info.headCommit!,
        );
        assertEquals(changed, true);

        await removeAgentWorktree(
          info.worktreePath,
          info.worktreeBranch,
          info.gitRoot,
        );
      } finally {
        await cleanDir(repo);
      }
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "worktree: hasChanges returns true for new commits",
  async fn() {
    await withTempHlvmDir(async () => {
      const repo = await createTestRepo();
      try {
        const info = await createAgentWorktree("commit-test", repo);

        // Make a commit in the worktree
        await platform.fs.writeTextFile(
          `${info.worktreePath}/committed.txt`,
          "committed by agent",
        );
        await runGit(["add", "committed.txt"], info.worktreePath);
        await runGit(["commit", "-m", "agent commit"], info.worktreePath);

        const changed = await hasWorktreeChanges(
          info.worktreePath,
          info.headCommit!,
        );
        assertEquals(changed, true);

        await removeAgentWorktree(
          info.worktreePath,
          info.worktreeBranch,
          info.gitRoot,
        );
      } finally {
        await cleanDir(repo);
      }
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================
// cleanupWorktree
// ============================================================

Deno.test({
  name: "worktree: cleanup removes clean worktree",
  async fn() {
    await withTempHlvmDir(async () => {
      const repo = await createTestRepo();
      try {
        const info = await createAgentWorktree("cleanup-clean", repo);
        const result = await cleanupWorktree(info);

        // Clean worktree should be removed
        assertEquals(result.worktreePath, undefined);
        assertEquals(result.worktreeBranch, undefined);

        // Verify directory is gone
        try {
          await platform.fs.stat(info.worktreePath);
          throw new Error("Worktree dir should not exist");
        } catch (err) {
          // Expected — directory removed
          assertStringIncludes(String(err), "NotFound");
        }
      } finally {
        await cleanDir(repo);
      }
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "worktree: cleanup keeps dirty worktree",
  async fn() {
    await withTempHlvmDir(async () => {
      const repo = await createTestRepo();
      try {
        const info = await createAgentWorktree("cleanup-dirty", repo);

        // Make change
        await platform.fs.writeTextFile(
          `${info.worktreePath}/agent-output.txt`,
          "important work",
        );

        const result = await cleanupWorktree(info);

        // Dirty worktree should be kept
        assertExists(result.worktreePath);
        assertEquals(result.worktreePath, info.worktreePath);

        // Verify directory still exists
        const stat = await platform.fs.stat(info.worktreePath);
        assertEquals(stat.isDirectory, true);

        // Manual cleanup
        await removeAgentWorktree(
          info.worktreePath,
          info.worktreeBranch,
          info.gitRoot,
        );
      } finally {
        await cleanDir(repo);
      }
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "worktree: cleanup handles null info",
  async fn() {
    await withTempHlvmDir(async () => {
      const result = await cleanupWorktree(null);
      assertEquals(result.worktreePath, undefined);
      assertEquals(result.worktreeBranch, undefined);
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
