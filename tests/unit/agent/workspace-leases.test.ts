import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert";
import { createWorkspaceLease } from "../../../src/hlvm/agent/workspace-leases.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

const platform = getPlatform();
const decoder = new TextDecoder();

async function runGit(
  cwd: string,
  args: string[],
): Promise<{ success: boolean; code: number; stdout: string; stderr: string }> {
  const result = await platform.command.output({
    cmd: ["git", ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  return {
    success: result.success,
    code: result.code,
    stdout: decoder.decode(result.stdout).trim(),
    stderr: decoder.decode(result.stderr).trim(),
  };
}

async function expectGitSuccess(cwd: string, args: string[]): Promise<void> {
  const result = await runGit(cwd, args);
  assertEquals(
    result.success,
    true,
    `git ${args.join(" ")} failed (${result.code}): ${
      result.stderr || result.stdout
    }`,
  );
}

Deno.test("createWorkspaceLease falls back to temp_dir outside a git repo", async () => {
  const parentDir = await platform.fs.makeTempDir({
    prefix: "hlvm-lease-temp-",
  });
  try {
    await platform.fs.writeTextFile(
      platform.path.join(parentDir, "existing.txt"),
      "parent version",
    );

    const lease = await createWorkspaceLease(parentDir, "temp-thread-1234");
    assertExists(lease);
    assertEquals(lease.kind, "temp_dir");
    assertEquals(lease.sandboxCapability, "basic");

    const childFile = platform.path.join(lease.path, "existing.txt");
    const parentFile = platform.path.join(parentDir, "existing.txt");
    assertEquals(await platform.fs.readTextFile(childFile), "parent version");

    await platform.fs.writeTextFile(childFile, "child version");
    assertEquals(await platform.fs.readTextFile(parentFile), "parent version");

    await lease.cleanup();
    try {
      await platform.fs.stat(lease.path);
      throw new Error("lease path should have been removed");
    } catch (error) {
      assertEquals(error instanceof Deno.errors.NotFound, true);
    }
  } finally {
    await platform.fs.remove(parentDir, { recursive: true });
  }
});

Deno.test("createWorkspaceLease prefers git_worktree inside a git workspace", async () => {
  const repoDir = await platform.fs.makeTempDir({ prefix: "hlvm-lease-git-" });
  const workspaceDir = platform.path.join(repoDir, "packages", "feature");
  try {
    await platform.fs.mkdir(workspaceDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(workspaceDir, "module.ts"),
      'export const version = "parent";\n',
    );

    await expectGitSuccess(repoDir, ["init"]);
    await expectGitSuccess(repoDir, ["add", "."]);
    await expectGitSuccess(repoDir, [
      "-c",
      "user.name=HLVM Test",
      "-c",
      "user.email=hlvm@example.com",
      "commit",
      "-m",
      "init",
    ]);

    const lease = await createWorkspaceLease(workspaceDir, "git-thread-1234");
    assertExists(lease);
    assertEquals(lease.kind, "git_worktree");
    assertEquals(lease.sandboxCapability, "restricted");
    assertEquals(
      lease.path.endsWith(platform.path.join("packages", "feature")),
      true,
    );

    const childFile = platform.path.join(lease.path, "module.ts");
    const parentFile = platform.path.join(workspaceDir, "module.ts");
    assertEquals(
      await platform.fs.readTextFile(childFile),
      'export const version = "parent";\n',
    );

    await platform.fs.writeTextFile(
      childFile,
      'export const version = "child";\n',
    );
    assertEquals(
      await platform.fs.readTextFile(parentFile),
      'export const version = "parent";\n',
    );

    await lease.cleanup();
    try {
      await platform.fs.stat(lease.path);
      throw new Error("worktree lease path should have been removed");
    } catch (error) {
      assertEquals(error instanceof Deno.errors.NotFound, true);
    }
  } finally {
    await platform.fs.remove(repoDir, { recursive: true });
  }
});

Deno.test("createWorkspaceLease git_worktree includes parent uncommitted changes", async () => {
  const repoDir = await platform.fs.makeTempDir({
    prefix: "hlvm-lease-dirty-",
  });
  try {
    // Set up repo with initial commit
    await platform.fs.writeTextFile(
      platform.path.join(repoDir, "committed.txt"),
      "committed content\n",
    );
    await expectGitSuccess(repoDir, ["init"]);
    await expectGitSuccess(repoDir, ["add", "."]);
    await expectGitSuccess(repoDir, [
      "-c",
      "user.name=HLVM Test",
      "-c",
      "user.email=hlvm@example.com",
      "commit",
      "-m",
      "init",
    ]);

    // Make uncommitted changes: modify a tracked file + add an untracked file
    await platform.fs.writeTextFile(
      platform.path.join(repoDir, "committed.txt"),
      "dirty tracked content\n",
    );
    await platform.fs.writeTextFile(
      platform.path.join(repoDir, "untracked.txt"),
      "untracked content\n",
    );

    const lease = await createWorkspaceLease(repoDir, "dirty-thread-1234");
    assertExists(lease);
    assertEquals(lease.kind, "git_worktree");

    // Verify dirty tracked file has parent's working-tree content (not HEAD)
    const trackedContent = await platform.fs.readTextFile(
      platform.path.join(lease.path, "committed.txt"),
    );
    assertEquals(trackedContent, "dirty tracked content\n");

    // Verify untracked file was copied
    const untrackedContent = await platform.fs.readTextFile(
      platform.path.join(lease.path, "untracked.txt"),
    );
    assertEquals(untrackedContent, "untracked content\n");

    await lease.cleanup();
  } finally {
    await platform.fs.remove(repoDir, { recursive: true });
  }
});

Deno.test("createWorkspaceLease falls back to temp_dir when worktree dirty-state mirroring fails", async () => {
  const repoDir = await platform.fs.makeTempDir({
    prefix: "hlvm-lease-dirty-fallback-",
  });
  try {
    await platform.fs.writeTextFile(
      platform.path.join(repoDir, "committed.txt"),
      "committed content\n",
    );
    await expectGitSuccess(repoDir, ["init"]);
    await expectGitSuccess(repoDir, ["add", "."]);
    await expectGitSuccess(repoDir, [
      "-c",
      "user.name=HLVM Test",
      "-c",
      "user.email=hlvm@example.com",
      "commit",
      "-m",
      "init",
    ]);

    await platform.fs.writeTextFile(
      platform.path.join(repoDir, "committed.txt"),
      "dirty tracked content\n",
    );
    await platform.fs.writeTextFile(
      platform.path.join(repoDir, "untracked.txt"),
      "untracked content\n",
    );

    // Snapshot worktree count before the lease attempt so we can verify
    // that the failed worktree was cleaned up (no orphan worktrees).
    const worktreesBefore = await runGit(repoDir, ["worktree", "list"]);
    assertEquals(worktreesBefore.success, true);
    const worktreeCountBefore =
      worktreesBefore.stdout.split("\n").filter((l) => l.trim()).length;

    const originalWriteFile = platform.fs.writeFile;
    (platform.fs as typeof platform.fs & {
      writeFile: typeof originalWriteFile;
    }).writeFile = async (path, data) => {
      if (String(path).includes("hlvm-worktree-")) {
        throw new Error("forced worktree copy failure");
      }
      await originalWriteFile(path, data);
    };

    try {
      const lease = await createWorkspaceLease(
        repoDir,
        "dirty-fallback-thread-1234",
      );
      assertExists(lease);

      // 1. Fallback produced a temp_dir lease, not a git_worktree
      assertEquals(lease.kind, "temp_dir");
      assertEquals(lease.sandboxCapability, "basic");

      // 2. Fallback lease path lives inside the parent workspace
      //    (createTempDirLease creates a subdirectory of the parent)
      assertStringIncludes(lease.path, repoDir);

      // 3. The fallback still has correct file contents (dirty state copied)
      assertEquals(
        await platform.fs.readTextFile(
          platform.path.join(lease.path, "committed.txt"),
        ),
        "dirty tracked content\n",
      );
      assertEquals(
        await platform.fs.readTextFile(
          platform.path.join(lease.path, "untracked.txt"),
        ),
        "untracked content\n",
      );

      // 4. No orphan worktrees left behind: the failed worktree was cleaned up
      //    before the fallback. The count should be the same as before.
      const worktreesAfter = await runGit(repoDir, ["worktree", "list"]);
      assertEquals(worktreesAfter.success, true);
      const worktreeCountAfter =
        worktreesAfter.stdout.split("\n").filter((l) => l.trim()).length;
      assertEquals(
        worktreeCountAfter,
        worktreeCountBefore,
        `Expected no orphan worktrees after fallback, but worktree count changed from ${worktreeCountBefore} to ${worktreeCountAfter}`,
      );

      // 5. Cleanup removes the lease directory
      const leasePath = lease.path;
      await lease.cleanup();
      try {
        await platform.fs.stat(leasePath);
        throw new Error("fallback lease path should have been removed after cleanup");
      } catch (error) {
        assertEquals(
          error instanceof Deno.errors.NotFound,
          true,
          `Expected NotFound after cleanup, got: ${error}`,
        );
      }
    } finally {
      (platform.fs as typeof platform.fs & {
        writeFile: typeof originalWriteFile;
      }).writeFile = originalWriteFile;
    }
  } finally {
    await platform.fs.remove(repoDir, { recursive: true });
  }
});
