import { assertEquals, assertExists } from "jsr:@std/assert";
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
    `git ${args.join(" ")} failed (${result.code}): ${result.stderr || result.stdout}`,
  );
}

Deno.test("createWorkspaceLease falls back to temp_dir outside a git repo", async () => {
  const parentDir = await platform.fs.makeTempDir({ prefix: "hlvm-lease-temp-" });
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
    assertEquals(lease.path.endsWith(platform.path.join("packages", "feature")), true);

    const childFile = platform.path.join(lease.path, "module.ts");
    const parentFile = platform.path.join(workspaceDir, "module.ts");
    assertEquals(await platform.fs.readTextFile(childFile), 'export const version = "parent";\n');

    await platform.fs.writeTextFile(
      childFile,
      'export const version = "child";\n',
    );
    assertEquals(await platform.fs.readTextFile(parentFile), 'export const version = "parent";\n');

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
