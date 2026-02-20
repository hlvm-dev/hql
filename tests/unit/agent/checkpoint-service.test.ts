/**
 * Checkpoint Service Tests
 *
 * Verifies shadow-repo checkpoint creation, restore, and edge cases.
 * Uses real temp directories + real git (same pattern as git-tools.test.ts).
 */

import {
  assertEquals,
  assertMatch,
} from "jsr:@std/assert";
import {
  createCheckpoint,
  hasCheckpoint,
  restoreCheckpoint,
  _hashWorkspace,
  _isGitRepo,
} from "../../../src/hlvm/agent/checkpoint-service.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  getCheckpointsDir,
  resetHlvmDirCacheForTests,
} from "../../../src/common/paths.ts";

async function runCmd(args: string[], cwd: string) {
  const platform = getPlatform();
  const proc = platform.command.run({
    cmd: args,
    cwd,
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
  });
  const [, , status] = await Promise.all([
    proc.stdout
      ? new Response(proc.stdout as ReadableStream).text()
      : Promise.resolve(""),
    proc.stderr
      ? new Response(proc.stderr as ReadableStream).text()
      : Promise.resolve(""),
    proc.status,
  ]);
  return status;
}

async function setupGitWorkspace(): Promise<string> {
  const platform = getPlatform();
  const workspace = await platform.fs.makeTempDir({
    prefix: "hlvm-checkpoint-test-",
  });

  await runCmd(["git", "init"], workspace);
  await runCmd(["git", "config", "user.email", "test@test.com"], workspace);
  await runCmd(["git", "config", "user.name", "Test User"], workspace);

  // Create initial commit so we have a valid repo
  await platform.fs.writeTextFile(`${workspace}/readme.md`, "# Test\n");
  await runCmd(["git", "add", "."], workspace);
  await runCmd(["git", "commit", "-m", "initial commit"], workspace);

  return workspace;
}

async function cleanupWorkspace(workspace: string) {
  const platform = getPlatform();
  try {
    await platform.fs.remove(workspace, { recursive: true });
  } catch {
    // ignore
  }
}

// ============================================================
// hashWorkspace tests
// ============================================================

Deno.test({
  name: "Checkpoint: hashWorkspace returns consistent SHA-256 hex",
  async fn() {
    const hash1 = await _hashWorkspace("/tmp/my-project");
    const hash2 = await _hashWorkspace("/tmp/my-project");
    assertEquals(hash1, hash2);
    assertMatch(hash1, /^[0-9a-f]{64}$/);
  },
});

// ============================================================
// isGitRepo tests
// ============================================================

Deno.test({
  name: "Checkpoint: isGitRepo returns true for git workspace",
  async fn() {
    const workspace = await setupGitWorkspace();
    try {
      assertEquals(await _isGitRepo(workspace), true);
    } finally {
      await cleanupWorkspace(workspace);
    }
  },
});

Deno.test({
  name: "Checkpoint: isGitRepo returns false for non-git directory",
  async fn() {
    const platform = getPlatform();
    const dir = await platform.fs.makeTempDir({
      prefix: "hlvm-checkpoint-nogit-",
    });
    try {
      assertEquals(await _isGitRepo(dir), false);
    } finally {
      await cleanupWorkspace(dir);
    }
  },
});

// ============================================================
// createCheckpoint tests
// ============================================================

Deno.test({
  name: "Checkpoint: createCheckpoint skips non-git workspaces",
  async fn() {
    const platform = getPlatform();
    const dir = await platform.fs.makeTempDir({
      prefix: "hlvm-checkpoint-nogit-",
    });
    try {
      const result = await createCheckpoint(dir);
      assertEquals(result, null);
    } finally {
      await cleanupWorkspace(dir);
    }
  },
});

Deno.test({
  name: "Checkpoint: createCheckpoint returns commit hash on success",
  async fn() {
    const workspace = await setupGitWorkspace();
    try {
      const hash = await createCheckpoint(workspace);
      assertEquals(typeof hash, "string");
      assertMatch(hash!, /^[0-9a-f]{40}$/);
    } finally {
      await cleanupWorkspace(workspace);
    }
  },
});

Deno.test({
  name: "Checkpoint: createCheckpoint returns existing HEAD when clean",
  async fn() {
    const workspace = await setupGitWorkspace();
    try {
      // First checkpoint
      const hash1 = await createCheckpoint(workspace);
      assertEquals(typeof hash1, "string");

      // Second checkpoint without changes — should return same hash
      const hash2 = await createCheckpoint(workspace);
      assertEquals(hash1, hash2);
    } finally {
      await cleanupWorkspace(workspace);
    }
  },
});

Deno.test({
  name: "Checkpoint: createCheckpoint detects new changes",
  async fn() {
    const workspace = await setupGitWorkspace();
    try {
      const hash1 = await createCheckpoint(workspace);

      // Make a change
      await getPlatform().fs.writeTextFile(
        `${workspace}/new-file.txt`,
        "hello",
      );

      const hash2 = await createCheckpoint(workspace);
      assertEquals(typeof hash2, "string");
      assertEquals(hash1 !== hash2, true);
    } finally {
      await cleanupWorkspace(workspace);
    }
  },
});

Deno.test({
  name: "Checkpoint: shadow exclude always contains .git pattern",
  async fn() {
    const platform = getPlatform();
    const workspace = await setupGitWorkspace();
    try {
      // .github/ should not satisfy the .git exclusion requirement.
      await platform.fs.writeTextFile(
        `${workspace}/.gitignore`,
        ".github/\nnode_modules/\n",
      );

      await createCheckpoint(workspace);

      const shadowDir = platform.path.join(
        getCheckpointsDir(),
        await _hashWorkspace(workspace),
      );
      const excludePath = platform.path.join(shadowDir, "info", "exclude");
      const excludeContent = await platform.fs.readTextFile(excludePath);
      assertMatch(excludeContent, /(^|\n)\.git(\n|$)/);
    } finally {
      await cleanupWorkspace(workspace);
    }
  },
});

Deno.test({
  name: "Checkpoint: shadow exclude does not duplicate existing .git pattern",
  async fn() {
    const platform = getPlatform();
    const workspace = await setupGitWorkspace();
    try {
      await platform.fs.writeTextFile(
        `${workspace}/.gitignore`,
        "node_modules/\n.git\n",
      );

      await createCheckpoint(workspace);

      const shadowDir = platform.path.join(
        getCheckpointsDir(),
        await _hashWorkspace(workspace),
      );
      const excludePath = platform.path.join(shadowDir, "info", "exclude");
      const excludeContent = await platform.fs.readTextFile(excludePath);
      const gitPatternCount = excludeContent
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/\/+$/, ""))
        .filter((line) =>
          line === ".git" || line === "/.git" || line === "**/.git"
        ).length;
      assertEquals(gitPatternCount, 1);
    } finally {
      await cleanupWorkspace(workspace);
    }
  },
});

Deno.test({
  name: "Checkpoint: excludes HLVM checkpoints when HLVM_DIR is inside workspace",
  async fn() {
    const platform = getPlatform();
    const workspace = await setupGitWorkspace();
    const originalHlvmDir = platform.env.get("HLVM_DIR");
    const originalHlvmHome = platform.env.get("HLVM_HOME");
    try {
      platform.env.set("HLVM_DIR", `${workspace}/.hlvm`);
      platform.env.set("HLVM_HOME", "");
      resetHlvmDirCacheForTests();

      await createCheckpoint(workspace);

      const shadowDir = platform.path.join(
        getCheckpointsDir(),
        await _hashWorkspace(workspace),
      );
      const proc = platform.command.run({
        cmd: ["git", "ls-tree", "-r", "--name-only", "HEAD"],
        cwd: workspace,
        stdout: "piped",
        stderr: "piped",
        stdin: "null",
        env: {
          GIT_DIR: shadowDir,
          GIT_WORK_TREE: workspace,
        },
      });
      const [stdout, , status] = await Promise.all([
        proc.stdout
          ? new Response(proc.stdout as ReadableStream).text()
          : Promise.resolve(""),
        proc.stderr
          ? new Response(proc.stderr as ReadableStream).text()
          : Promise.resolve(""),
        proc.status,
      ]);
      assertEquals(status.code, 0);
      const trackedPaths = stdout.split(/\r?\n/).filter(Boolean);
      assertEquals(
        trackedPaths.some((path) => path.startsWith(".hlvm/checkpoints/")),
        false,
      );
    } finally {
      platform.env.set("HLVM_DIR", originalHlvmDir ?? "");
      platform.env.set("HLVM_HOME", originalHlvmHome ?? "");
      resetHlvmDirCacheForTests();
      await cleanupWorkspace(workspace);
    }
  },
});

// ============================================================
// hasCheckpoint tests
// ============================================================

Deno.test({
  name: "Checkpoint: hasCheckpoint returns false when no checkpoint exists",
  async fn() {
    const platform = getPlatform();
    const dir = await platform.fs.makeTempDir({
      prefix: "hlvm-checkpoint-nocp-",
    });
    try {
      assertEquals(await hasCheckpoint(dir), false);
    } finally {
      await cleanupWorkspace(dir);
    }
  },
});

Deno.test({
  name: "Checkpoint: hasCheckpoint returns true after createCheckpoint",
  async fn() {
    const workspace = await setupGitWorkspace();
    try {
      assertEquals(await hasCheckpoint(workspace), false);
      await createCheckpoint(workspace);
      assertEquals(await hasCheckpoint(workspace), true);
    } finally {
      await cleanupWorkspace(workspace);
    }
  },
});

// ============================================================
// restoreCheckpoint tests
// ============================================================

Deno.test({
  name: "Checkpoint: restoreCheckpoint returns error when no checkpoint exists",
  async fn() {
    const workspace = await setupGitWorkspace();
    // Don't create a checkpoint — no shadow repo
    try {
      const result = await restoreCheckpoint(workspace);
      assertEquals(result.restored, false);
    } finally {
      await cleanupWorkspace(workspace);
    }
  },
});

Deno.test({
  name: "Checkpoint: restoreCheckpoint restores modified files",
  async fn() {
    const platform = getPlatform();
    const workspace = await setupGitWorkspace();
    try {
      // Checkpoint original state
      await createCheckpoint(workspace);

      // Modify a file
      await platform.fs.writeTextFile(`${workspace}/readme.md`, "# Modified\n");

      // Restore
      const result = await restoreCheckpoint(workspace);
      assertEquals(result.restored, true);
      assertEquals(typeof result.hash, "string");

      // Verify file was restored
      const content = await platform.fs.readTextFile(
        `${workspace}/readme.md`,
      );
      assertEquals(content, "# Test\n");
    } finally {
      await cleanupWorkspace(workspace);
    }
  },
});

Deno.test({
  name: "Checkpoint: restoreCheckpoint removes new files added after checkpoint",
  async fn() {
    const platform = getPlatform();
    const workspace = await setupGitWorkspace();
    try {
      // Checkpoint original state
      await createCheckpoint(workspace);

      // Add a new file
      await platform.fs.writeTextFile(
        `${workspace}/unwanted.txt`,
        "should be removed",
      );

      // Restore
      const result = await restoreCheckpoint(workspace);
      assertEquals(result.restored, true);

      // Verify new file was removed
      let exists = true;
      try {
        await platform.fs.stat(`${workspace}/unwanted.txt`);
      } catch {
        exists = false;
      }
      assertEquals(exists, false);
    } finally {
      await cleanupWorkspace(workspace);
    }
  },
});

Deno.test({
  name: "Checkpoint: errors are non-blocking (returns null/false)",
  async fn() {
    // Invalid workspace path — should not throw
    const result = await createCheckpoint("/nonexistent/path/that/does/not/exist");
    assertEquals(result, null);

    const restoreResult = await restoreCheckpoint("/nonexistent/path/that/does/not/exist");
    assertEquals(restoreResult.restored, false);
  },
});
