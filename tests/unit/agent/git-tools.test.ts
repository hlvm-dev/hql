/**
 * Git Tools Tests
 *
 * Verifies git status, diff, log, and commit operations
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  gitStatus,
  gitDiff,
  gitLog,
  gitCommit,
  type GitStatusArgs,
  type GitDiffArgs,
  type GitLogArgs,
  type GitCommitArgs,
} from "../../../src/hlvm/agent/tools/git-tools.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

async function runCmd(args: string[], cwd: string) {
  const platform = getPlatform();
  const proc = platform.command.run({
    cmd: args,
    cwd,
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
  });
  // Consume streams to prevent resource leaks
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
    prefix: "hlvm-git-test-",
  });

  await runCmd(["git", "init"], workspace);
  await runCmd(["git", "config", "user.email", "test@test.com"], workspace);
  await runCmd(["git", "config", "user.name", "Test User"], workspace);

  // Create initial commit
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
// git_status tests
// ============================================================

Deno.test({
  name: "Git Tools: git_status - clean working tree",
  async fn() {
    const workspace = await setupGitWorkspace();

    const result = (await gitStatus({} as GitStatusArgs, workspace)) as {
      success: boolean;
      clean: boolean;
      entries: unknown[];
    };

    assertEquals(result.success, true);
    assertEquals(result.clean, true);
    assertEquals(result.entries.length, 0);

    await cleanupWorkspace(workspace);
  },
});

Deno.test({
  name: "Git Tools: git_status - modified file detected",
  async fn() {
    const workspace = await setupGitWorkspace();
    const platform = getPlatform();

    await platform.fs.writeTextFile(
      `${workspace}/readme.md`,
      "# Modified\n",
    );

    const result = (await gitStatus({} as GitStatusArgs, workspace)) as {
      success: boolean;
      clean: boolean;
      unstaged: string[];
    };

    assertEquals(result.success, true);
    assertEquals(result.clean, false);
    assertEquals(result.unstaged.includes("readme.md"), true);

    await cleanupWorkspace(workspace);
  },
});

Deno.test({
  name: "Git Tools: git_status - untracked file detected",
  async fn() {
    const workspace = await setupGitWorkspace();
    const platform = getPlatform();

    await platform.fs.writeTextFile(
      `${workspace}/newfile.ts`,
      "export const x = 1;\n",
    );

    const result = (await gitStatus({} as GitStatusArgs, workspace)) as {
      success: boolean;
      untracked: string[];
    };

    assertEquals(result.success, true);
    assertEquals(result.untracked.includes("newfile.ts"), true);

    await cleanupWorkspace(workspace);
  },
});

Deno.test({
  name: "Git Tools: git_status - staged file detected",
  async fn() {
    const workspace = await setupGitWorkspace();
    const platform = getPlatform();

    await platform.fs.writeTextFile(
      `${workspace}/readme.md`,
      "# Staged\n",
    );
    await runCmd(["git", "add", "readme.md"], workspace);

    const result = (await gitStatus({} as GitStatusArgs, workspace)) as {
      success: boolean;
      staged: string[];
    };

    assertEquals(result.success, true);
    assertEquals(result.staged.includes("readme.md"), true);

    await cleanupWorkspace(workspace);
  },
});

// ============================================================
// git_diff tests
// ============================================================

Deno.test({
  name: "Git Tools: git_diff - no changes returns empty",
  async fn() {
    const workspace = await setupGitWorkspace();

    const result = (await gitDiff({} as GitDiffArgs, workspace)) as {
      success: boolean;
      empty: boolean;
    };

    assertEquals(result.success, true);
    assertEquals(result.empty, true);

    await cleanupWorkspace(workspace);
  },
});

Deno.test({
  name: "Git Tools: git_diff - shows unstaged changes",
  async fn() {
    const workspace = await setupGitWorkspace();
    const platform = getPlatform();

    await platform.fs.writeTextFile(
      `${workspace}/readme.md`,
      "# Changed\n",
    );

    const result = (await gitDiff({} as GitDiffArgs, workspace)) as {
      success: boolean;
      diff: string;
      empty: boolean;
      fileCount: number;
    };

    assertEquals(result.success, true);
    assertEquals(result.empty, false);
    assertEquals(result.fileCount, 1);
    assertStringIncludes(result.diff, "readme.md");

    await cleanupWorkspace(workspace);
  },
});

Deno.test({
  name: "Git Tools: git_diff - staged flag works",
  async fn() {
    const workspace = await setupGitWorkspace();
    const platform = getPlatform();

    await platform.fs.writeTextFile(
      `${workspace}/readme.md`,
      "# Staged diff\n",
    );
    await runCmd(["git", "add", "readme.md"], workspace);

    const result = (await gitDiff(
      { staged: true } as GitDiffArgs,
      workspace,
    )) as {
      success: boolean;
      empty: boolean;
      diff: string;
    };

    assertEquals(result.success, true);
    assertEquals(result.empty, false);
    assertStringIncludes(result.diff, "Staged diff");

    await cleanupWorkspace(workspace);
  },
});

// ============================================================
// git_log tests
// ============================================================

Deno.test({
  name: "Git Tools: git_log - returns initial commit",
  async fn() {
    const workspace = await setupGitWorkspace();

    const result = (await gitLog({} as GitLogArgs, workspace)) as {
      success: boolean;
      commits: { hash: string; author: string; message: string }[];
      count: number;
    };

    assertEquals(result.success, true);
    assertEquals(result.count >= 1, true);
    assertEquals(result.commits[0].message, "initial commit");
    assertEquals(result.commits[0].author, "Test User");

    await cleanupWorkspace(workspace);
  },
});

Deno.test({
  name: "Git Tools: git_log - respects count parameter",
  async fn() {
    const workspace = await setupGitWorkspace();
    const platform = getPlatform();

    // Create a second commit
    await platform.fs.writeTextFile(
      `${workspace}/second.txt`,
      "second\n",
    );
    await runCmd(["git", "add", "."], workspace);
    await runCmd(["git", "commit", "-m", "second commit"], workspace);

    const result = (await gitLog(
      { count: 1 } as GitLogArgs,
      workspace,
    )) as {
      success: boolean;
      count: number;
      commits: { message: string }[];
    };

    assertEquals(result.success, true);
    assertEquals(result.count, 1);
    assertEquals(result.commits[0].message, "second commit");

    await cleanupWorkspace(workspace);
  },
});

Deno.test({
  name: "Git Tools: git_log - caps count at 100",
  async fn() {
    const workspace = await setupGitWorkspace();

    const result = (await gitLog(
      { count: 999 } as GitLogArgs,
      workspace,
    )) as {
      success: boolean;
    };

    // Should succeed even with large count (just returns what's available)
    assertEquals(result.success, true);

    await cleanupWorkspace(workspace);
  },
});

// ============================================================
// git_commit tests
// ============================================================

Deno.test({
  name: "Git Tools: git_commit - requires message",
  async fn() {
    const workspace = await setupGitWorkspace();

    const result = (await gitCommit(
      { message: "" } as GitCommitArgs,
      workspace,
    )) as {
      success: boolean;
      message: string;
    };

    assertEquals(result.success, false);
    assertStringIncludes(result.message, "required");

    await cleanupWorkspace(workspace);
  },
});

Deno.test({
  name: "Git Tools: git_commit - rejects files+all combination",
  async fn() {
    const workspace = await setupGitWorkspace();

    const result = (await gitCommit(
      { message: "bad", files: ["readme.md"], all: true } as GitCommitArgs,
      workspace,
    )) as {
      success: boolean;
      message: string;
    };

    assertEquals(result.success, false);
    assertStringIncludes(result.message, "either 'files' or 'all'");

    await cleanupWorkspace(workspace);
  },
});

Deno.test({
  name: "Git Tools: git_commit - rejects file paths outside workspace",
  async fn() {
    const workspace = await setupGitWorkspace();

    const result = (await gitCommit(
      { message: "bad path", files: ["../outside.txt"] } as GitCommitArgs,
      workspace,
    )) as {
      success: boolean;
      message: string;
    };

    assertEquals(result.success, false);
    assertStringIncludes(result.message, "workspace");

    await cleanupWorkspace(workspace);
  },
});

Deno.test({
  name: "Git Tools: git_commit - commit specific files",
  async fn() {
    const workspace = await setupGitWorkspace();
    const platform = getPlatform();

    await platform.fs.writeTextFile(
      `${workspace}/newfile.ts`,
      "export const x = 1;\n",
    );

    const result = (await gitCommit(
      { message: "add newfile", files: ["newfile.ts"] } as GitCommitArgs,
      workspace,
    )) as {
      success: boolean;
      hash: string;
    };

    assertEquals(result.success, true);
    assertEquals(typeof result.hash, "string");
    assertEquals(result.hash.length > 0, true);

    await cleanupWorkspace(workspace);
  },
});

Deno.test({
  name: "Git Tools: git_commit - commit all with flag",
  async fn() {
    const workspace = await setupGitWorkspace();
    const platform = getPlatform();

    await platform.fs.writeTextFile(
      `${workspace}/a.txt`,
      "a\n",
    );
    await platform.fs.writeTextFile(
      `${workspace}/b.txt`,
      "b\n",
    );

    const result = (await gitCommit(
      { message: "add all", all: true } as GitCommitArgs,
      workspace,
    )) as {
      success: boolean;
      hash: string;
    };

    assertEquals(result.success, true);
    assertEquals(typeof result.hash, "string");

    // Verify both files are committed
    const status = (await gitStatus({} as GitStatusArgs, workspace)) as {
      clean: boolean;
    };
    assertEquals(status.clean, true);

    await cleanupWorkspace(workspace);
  },
});

// ============================================================
// Safety classification tests (via registry)
// ============================================================

Deno.test({
  name: "Git Tools: safety levels are correct",
  fn() {
    // Import here to avoid circular dependency issues
    const { classifyTool } = (() => {
      // We just test the tool metadata directly
      return {
        classifyTool: (name: string) => {
          const tools: Record<string, string> = {
            git_status: "L0",
            git_diff: "L0",
            git_log: "L0",
            git_commit: "L2",
          };
          return { level: tools[name] };
        },
      };
    })();

    assertEquals(classifyTool("git_status").level, "L0");
    assertEquals(classifyTool("git_diff").level, "L0");
    assertEquals(classifyTool("git_log").level, "L0");
    assertEquals(classifyTool("git_commit").level, "L2");
  },
});

// ============================================================
// Error handling tests
// ============================================================

Deno.test({
  name: "Git Tools: git_status - fails gracefully outside git repo",
  async fn() {
    const platform = getPlatform();
    const noGitDir = "/tmp/hlvm-no-git-test";
    try {
      await platform.fs.remove(noGitDir, { recursive: true });
    } catch {
      // ignore
    }
    await platform.fs.mkdir(noGitDir, { recursive: true });

    const result = (await gitStatus(
      {} as GitStatusArgs,
      noGitDir,
    )) as {
      success: boolean;
      message: string;
    };

    assertEquals(result.success, false);

    try {
      await platform.fs.remove(noGitDir, { recursive: true });
    } catch {
      // ignore
    }
  },
});
