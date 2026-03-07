import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  gitCommit,
  gitDiff,
  gitLog,
  gitStatus,
  type GitCommitArgs,
  type GitDiffArgs,
  type GitLogArgs,
  type GitStatusArgs,
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

  const [, , status] = await Promise.all([
    proc.stdout ? new Response(proc.stdout as ReadableStream).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr as ReadableStream).text() : Promise.resolve(""),
    proc.status,
  ]);

  return status;
}

async function setupGitWorkspace(): Promise<string> {
  const platform = getPlatform();
  const workspace = await platform.fs.makeTempDir({ prefix: "hlvm-git-test-" });

  await runCmd(["git", "init"], workspace);
  await runCmd(["git", "config", "user.email", "test@test.com"], workspace);
  await runCmd(["git", "config", "user.name", "Test User"], workspace);
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

async function withGitWorkspace<T>(fn: (workspace: string) => Promise<T>): Promise<T> {
  const workspace = await setupGitWorkspace();
  try {
    return await fn(workspace);
  } finally {
    await cleanupWorkspace(workspace);
  }
}

Deno.test("git tools: gitStatus distinguishes clean, unstaged, untracked, and staged changes", async () => {
  await withGitWorkspace(async (workspace) => {
    const platform = getPlatform();
    const clean = await gitStatus({} as GitStatusArgs, workspace) as {
      success: boolean;
      clean: boolean;
      entries: unknown[];
    };
    assertEquals(clean.success, true);
    assertEquals(clean.clean, true);
    assertEquals(clean.entries.length, 0);

    await platform.fs.writeTextFile(`${workspace}/readme.md`, "# Modified\n");
    const modified = await gitStatus({} as GitStatusArgs, workspace) as {
      success: boolean;
      clean: boolean;
      unstaged: string[];
    };
    assertEquals(modified.success, true);
    assertEquals(modified.clean, false);
    assertEquals(modified.unstaged.includes("readme.md"), true);

    await platform.fs.writeTextFile(`${workspace}/newfile.ts`, "export const x = 1;\n");
    const untracked = await gitStatus({} as GitStatusArgs, workspace) as {
      success: boolean;
      untracked: string[];
    };
    assertEquals(untracked.success, true);
    assertEquals(untracked.untracked.includes("newfile.ts"), true);

    await runCmd(["git", "add", "readme.md"], workspace);
    const staged = await gitStatus({} as GitStatusArgs, workspace) as {
      success: boolean;
      staged: string[];
    };
    assertEquals(staged.success, true);
    assertEquals(staged.staged.includes("readme.md"), true);
  });
});

Deno.test("git tools: gitDiff handles empty, unstaged, and staged diffs", async () => {
  await withGitWorkspace(async (workspace) => {
    const platform = getPlatform();
    const empty = await gitDiff({} as GitDiffArgs, workspace) as {
      success: boolean;
      empty: boolean;
    };
    assertEquals(empty.success, true);
    assertEquals(empty.empty, true);

    await platform.fs.writeTextFile(`${workspace}/readme.md`, "# Changed\n");
    const unstaged = await gitDiff({} as GitDiffArgs, workspace) as {
      success: boolean;
      diff: string;
      empty: boolean;
      fileCount: number;
    };
    assertEquals(unstaged.success, true);
    assertEquals(unstaged.empty, false);
    assertEquals(unstaged.fileCount, 1);
    assertStringIncludes(unstaged.diff, "readme.md");

    await runCmd(["git", "add", "readme.md"], workspace);
    const staged = await gitDiff({ staged: true } as GitDiffArgs, workspace) as {
      success: boolean;
      empty: boolean;
      diff: string;
    };
    assertEquals(staged.success, true);
    assertEquals(staged.empty, false);
    assertStringIncludes(staged.diff, "Changed");
  });
});

Deno.test("git tools: gitLog returns commit metadata and honors count capping", async () => {
  await withGitWorkspace(async (workspace) => {
    const platform = getPlatform();
    const initial = await gitLog({} as GitLogArgs, workspace) as {
      success: boolean;
      commits: { hash: string; author: string; message: string }[];
      count: number;
    };
    assertEquals(initial.success, true);
    assertEquals(initial.count >= 1, true);
    assertEquals(initial.commits[0].message, "initial commit");
    assertEquals(initial.commits[0].author, "Test User");

    await platform.fs.writeTextFile(`${workspace}/second.txt`, "second\n");
    await runCmd(["git", "add", "."], workspace);
    await runCmd(["git", "commit", "-m", "second commit"], workspace);

    const limited = await gitLog({ count: 1 } as GitLogArgs, workspace) as {
      success: boolean;
      count: number;
      commits: { message: string }[];
    };
    assertEquals(limited.success, true);
    assertEquals(limited.count, 1);
    assertEquals(limited.commits[0].message, "second commit");

    const capped = await gitLog({ count: 999 } as GitLogArgs, workspace) as {
      success: boolean;
    };
    assertEquals(capped.success, true);
  });
});

Deno.test("git tools: gitCommit rejects invalid input and paths outside the workspace", async () => {
  await withGitWorkspace(async (workspace) => {
    const missingMessage = await gitCommit(
      { message: "" } as GitCommitArgs,
      workspace,
    ) as { success: boolean; message: string };
    assertEquals(missingMessage.success, false);
    assertStringIncludes(missingMessage.message, "required");

    const conflictingArgs = await gitCommit(
      { message: "bad", files: ["readme.md"], all: true } as GitCommitArgs,
      workspace,
    ) as { success: boolean; message: string };
    assertEquals(conflictingArgs.success, false);
    assertStringIncludes(conflictingArgs.message, "either 'files' or 'all'");

    const outsideWorkspace = await gitCommit(
      { message: "bad path", files: ["../outside.txt"] } as GitCommitArgs,
      workspace,
    ) as { success: boolean; message: string };
    assertEquals(outsideWorkspace.success, false);
    assertStringIncludes(outsideWorkspace.message, "workspace");
  });
});

Deno.test("git tools: gitCommit supports file-scoped and all-files commits", async () => {
  await withGitWorkspace(async (workspace) => {
    const platform = getPlatform();
    await platform.fs.writeTextFile(`${workspace}/newfile.ts`, "export const x = 1;\n");

    const fileCommit = await gitCommit(
      { message: "add newfile", files: ["newfile.ts"] } as GitCommitArgs,
      workspace,
    ) as { success: boolean; hash: string };
    assertEquals(fileCommit.success, true);
    assertEquals(fileCommit.hash.length > 0, true);

    await platform.fs.writeTextFile(`${workspace}/a.txt`, "a\n");
    await platform.fs.writeTextFile(`${workspace}/b.txt`, "b\n");
    const allCommit = await gitCommit(
      { message: "add all", all: true } as GitCommitArgs,
      workspace,
    ) as { success: boolean; hash: string };
    assertEquals(allCommit.success, true);
    assertEquals(allCommit.hash.length > 0, true);

    const status = await gitStatus({} as GitStatusArgs, workspace) as { clean: boolean };
    assertEquals(status.clean, true);
  });
});

Deno.test("git tools: gitStatus fails gracefully outside a git repo", async () => {
  const platform = getPlatform();
  const noGitDir = await platform.fs.makeTempDir({ prefix: "hlvm-no-git-test-" });

  try {
    const result = await gitStatus({} as GitStatusArgs, noGitDir) as {
      success: boolean;
    };
    assertEquals(result.success, false);
  } finally {
    await platform.fs.remove(noGitDir, { recursive: true });
  }
});
