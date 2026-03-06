import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  classifyShellCommand,
  shellExec,
  type ShellExecArgs,
  shellScript,
  type ShellScriptArgs,
} from "../../../src/hlvm/agent/tools/shell-tools.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { cleanupWorkspaceDir } from "./workspace-test-helpers.ts";

async function withWorkspace<T>(fn: (workspace: string) => Promise<T>): Promise<T> {
  const platform = getPlatform();
  const workspace = await platform.fs.makeTempDir({ prefix: "hlvm-shell-test-" });

  try {
    await platform.fs.writeTextFile(
      platform.path.join(workspace, "test.txt"),
      "Hello, world!",
    );
    return await fn(workspace);
  } finally {
    await cleanupWorkspaceDir(workspace);
  }
}

Deno.test("shell tools: classifyShellCommand maps representative commands to L0, L1, and L2", () => {
  assertEquals(classifyShellCommand("git status"), "L0");
  assertEquals(classifyShellCommand("echo hello"), "L0");
  assertEquals(classifyShellCommand("deno test --dry-run"), "L1");
  assertEquals(classifyShellCommand("deno test"), "L1");
  assertEquals(classifyShellCommand("git push"), "L2");
  assertEquals(classifyShellCommand("rm -rf /"), "L2");
});

Deno.test("shell tools: shellExec runs simple commands, respects cwd, and reports safety level", async () => {
  await withWorkspace(async (workspace) => {
    const echoResult = await shellExec({ command: "echo hello" } as ShellExecArgs, workspace);
    const pwdResult = await shellExec(
      { command: "pwd", cwd: "." } as ShellExecArgs,
      workspace,
    );

    assertEquals(echoResult.success, true);
    assertEquals(echoResult.exitCode, 0);
    assertEquals(echoResult.safetyLevel, "L0");
    assertStringIncludes(echoResult.stdout, "hello");

    assertEquals(pwdResult.success, true);
    assertStringIncludes(pwdResult.stdout, workspace);
  });
});

Deno.test("shell tools: shellExec rejects bad cwd, empty commands, and surfaces command failures", async () => {
  await withWorkspace(async (workspace) => {
    const failedCommand = await shellExec(
      { command: "ls nonexistent-file" } as ShellExecArgs,
      workspace,
    );
    const emptyCommand = await shellExec(
      { command: "" } as ShellExecArgs,
      workspace,
    );
    const outsideWorkspace = await shellExec(
      { command: "pwd", cwd: "../../etc" } as ShellExecArgs,
      workspace,
    );

    assertEquals(failedCommand.success, false);
    assertEquals(failedCommand.exitCode, 1);
    assertStringIncludes(failedCommand.stderr, "nonexistent-file");

    assertEquals(emptyCommand.success, false);
    assertEquals((emptyCommand.message ?? "").length > 0, true);

    assertEquals(outsideWorkspace.success, false);
  });
});

Deno.test("shell tools: shellExec honors abort signals for long-running commands", async () => {
  if (getPlatform().build.os === "windows") return;

  await withWorkspace(async (workspace) => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const pending = shellExec(
      { command: "sleep 5" } as ShellExecArgs,
      workspace,
      { signal: controller.signal },
    );

    setTimeout(() => controller.abort(), 100);
    const result = await pending;

    assertEquals(result.success, false);
    assertStringIncludes((result.message ?? "").toLowerCase(), "aborted");
    assertEquals(Date.now() - startedAt < 4500, true);
  });
});

Deno.test("shell tools: shellScript executes multiline scripts, variables, interpreters, and cwd", async () => {
  await withWorkspace(async (workspace) => {
    const simple = await shellScript(
      {
        script: `NAME="World"
echo "Hello, $NAME!"`,
      } as ShellScriptArgs,
      workspace,
    );
    const bash = await shellScript(
      {
        script: `#!/bin/bash
for i in 1 2 3; do
  echo "Number: $i"
done`,
        interpreter: "bash",
      } as ShellScriptArgs,
      workspace,
    );
    const pwd = await shellScript(
      { script: "pwd", cwd: "." } as ShellScriptArgs,
      workspace,
    );

    assertEquals(simple.success, true);
    assertStringIncludes(simple.stdout, "Hello, World!");
    assertEquals(bash.success, true);
    assertStringIncludes(bash.stdout, "Number: 1");
    assertStringIncludes(bash.stdout, "Number: 3");
    assertEquals(pwd.success, true);
    assertStringIncludes(pwd.stdout, workspace);
  });
});

Deno.test("shell tools: shellScript tolerates command stderr, rejects bad cwd, and supports abort", async () => {
  if (getPlatform().build.os === "windows") return;

  await withWorkspace(async (workspace) => {
    const scriptWithError = await shellScript(
      {
        script: `echo "Before error"
ls nonexistent-file
echo "After error"`,
      } as ShellScriptArgs,
      workspace,
    );
    const outsideWorkspace = await shellScript(
      { script: "pwd", cwd: "../../etc" } as ShellScriptArgs,
      workspace,
    );

    const controller = new AbortController();
    const pending = shellScript(
      { script: "sleep 5" } as ShellScriptArgs,
      workspace,
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 100);
    const aborted = await pending;

    assertEquals(scriptWithError.success, true);
    assertStringIncludes(scriptWithError.stdout, "Before error");
    assertStringIncludes(scriptWithError.stdout, "After error");
    assertEquals(outsideWorkspace.success, false);
    assertEquals(aborted.success, false);
    assertStringIncludes((aborted.message ?? "").toLowerCase(), "aborted");
  });
});
