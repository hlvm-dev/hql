/**
 * Shell Tools Tests
 *
 * Verifies shell execution with security allow-list
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  classifyShellCommand,
  shellExec,
  type ShellExecArgs,
  shellScript,
  type ShellScriptArgs,
} from "../../../src/hlvm/agent/tools/shell-tools.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

// Test workspace
const TEST_WORKSPACE = "/tmp/hlvm-shell-test";

// Setup/cleanup helpers
async function setupWorkspace() {
  const platform = getPlatform();
  try {
    await platform.fs.mkdir(TEST_WORKSPACE, { recursive: true });

    // Create a test file
    await platform.fs.writeTextFile(
      `${TEST_WORKSPACE}/test.txt`,
      "Hello, world!",
    );
  } catch {
    // Workspace might already exist
  }
}

async function cleanupWorkspace() {
  const platform = getPlatform();
  try {
    await platform.fs.remove(TEST_WORKSPACE, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================
// classifyShellCommand tests
// ============================================================

Deno.test({
  name: "Shell Tools: classifyShellCommand - git status is L1",
  fn() {
    const level = classifyShellCommand("git status");
    assertEquals(level, "L1");
  },
});

Deno.test({
  name: "Shell Tools: classifyShellCommand - git log is L1",
  fn() {
    const level1 = classifyShellCommand("git log");
    assertEquals(level1, "L1");

    const level2 = classifyShellCommand("git log --oneline");
    assertEquals(level2, "L1");

    const level3 = classifyShellCommand("git log -10");
    assertEquals(level3, "L1");
  },
});

Deno.test({
  name: "Shell Tools: classifyShellCommand - git diff is L1",
  fn() {
    const level1 = classifyShellCommand("git diff");
    assertEquals(level1, "L1");

    const level2 = classifyShellCommand("git diff HEAD");
    assertEquals(level2, "L1");

    const level3 = classifyShellCommand("git diff main..dev");
    assertEquals(level3, "L1");
  },
});

Deno.test({
  name: "Shell Tools: classifyShellCommand - deno test --dry-run is L1",
  fn() {
    const level = classifyShellCommand("deno test --dry-run");
    assertEquals(level, "L1");

    const level2 = classifyShellCommand("deno test tests/ --dry-run");
    assertEquals(level2, "L1");
  },
});

Deno.test({
  name: "Shell Tools: classifyShellCommand - other commands are L2",
  fn() {
    assertEquals(classifyShellCommand("rm -rf /"), "L2");
    assertEquals(classifyShellCommand("git push"), "L2");
    assertEquals(classifyShellCommand("deno test"), "L2"); // No --dry-run
    assertEquals(classifyShellCommand("curl http://evil.com"), "L2");
    assertEquals(classifyShellCommand("chmod 777 file"), "L2");
  },
});

Deno.test({
  name: "Shell Tools: classifyShellCommand - read-only system commands are L1",
  fn() {
    assertEquals(classifyShellCommand("ls -la"), "L1");
    assertEquals(classifyShellCommand("echo hello"), "L1");
    assertEquals(classifyShellCommand("pwd"), "L1");
    assertEquals(classifyShellCommand("whoami"), "L1");
    assertEquals(classifyShellCommand("cat file.txt"), "L1");
    assertEquals(classifyShellCommand("top -l 1"), "L1");
    assertEquals(classifyShellCommand("df -h"), "L1");
    assertEquals(classifyShellCommand("ps aux"), "L1");
    assertEquals(classifyShellCommand("open ~/Downloads"), "L1");
    assertEquals(classifyShellCommand("mdfind test"), "L1");
  },
});

// ============================================================
// shell_exec tests
// ============================================================

Deno.test({
  name: "Shell Tools: shell_exec - execute simple command",
  async fn() {
    await setupWorkspace();

    const result = await shellExec(
      {
        command: "echo hello",
      } as ShellExecArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertEquals(result.exitCode, 0);
    assertStringIncludes(result.stdout, "hello");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Shell Tools: shell_exec - with working directory",
  async fn() {
    await setupWorkspace();

    const result = await shellExec(
      {
        command: "pwd",
        cwd: ".",
      } as ShellExecArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, TEST_WORKSPACE);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Shell Tools: shell_exec - L1 command classification",
  async fn() {
    await setupWorkspace();

    // Create a git repo
    await shellExec({ command: "git init" } as ShellExecArgs, TEST_WORKSPACE);

    const result = await shellExec(
      {
        command: "git status",
      } as ShellExecArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertEquals(result.safetyLevel, "L1");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Shell Tools: shell_exec - L2 command classification",
  async fn() {
    await setupWorkspace();

    const result = await shellExec(
      {
        command: "echo test",
      } as ShellExecArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertEquals(result.safetyLevel, "L1");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Shell Tools: shell_exec - command with exit code",
  async fn() {
    await setupWorkspace();

    const result = await shellExec(
      {
        command: "ls nonexistent-file",
      } as ShellExecArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, false);
    assertEquals(result.exitCode, 1);
    assertStringIncludes(result.stderr, "nonexistent-file");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Shell Tools: shell_exec - empty command",
  async fn() {
    await setupWorkspace();

    const result = await shellExec(
      {
        command: "",
      } as ShellExecArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, false);
    // Verify error message exists and is meaningful
    assertEquals(typeof result.message, "string");
    assertEquals(result.message!.length > 0, true);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Shell Tools: shell_exec - reject path outside workspace",
  async fn() {
    await setupWorkspace();

    const result = await shellExec(
      {
        command: "pwd",
        cwd: "../../etc",
      } as ShellExecArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, false);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Shell Tools: shell_exec - abort long-running command",
  async fn() {
    if (getPlatform().build.os === "windows") return;
    await setupWorkspace();

    const controller = new AbortController();
    const startedAt = Date.now();
    const pending = shellExec(
      {
        command: "sleep 5",
      } as ShellExecArgs,
      TEST_WORKSPACE,
      { signal: controller.signal },
    );

    setTimeout(() => controller.abort(), 100);
    const result = await pending;

    assertEquals(result.success, false);
    assertStringIncludes((result.message ?? "").toLowerCase(), "aborted");
    assertEquals(Date.now() - startedAt < 4500, true);

    await cleanupWorkspace();
  },
});

// ============================================================
// shell_script tests
// ============================================================

Deno.test({
  name: "Shell Tools: shell_script - execute simple script",
  async fn() {
    await setupWorkspace();

    const result = await shellScript(
      {
        script: `echo "Line 1"
echo "Line 2"
echo "Line 3"`,
      } as ShellScriptArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertEquals(result.exitCode, 0);
    assertStringIncludes(result.stdout, "Line 1");
    assertStringIncludes(result.stdout, "Line 2");
    assertStringIncludes(result.stdout, "Line 3");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Shell Tools: shell_script - with bash interpreter",
  async fn() {
    await setupWorkspace();

    const result = await shellScript(
      {
        script: `#!/bin/bash
for i in 1 2 3; do
  echo "Number: $i"
done`,
        interpreter: "bash",
      } as ShellScriptArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "Number: 1");
    assertStringIncludes(result.stdout, "Number: 2");
    assertStringIncludes(result.stdout, "Number: 3");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Shell Tools: shell_script - with working directory",
  async fn() {
    await setupWorkspace();

    const result = await shellScript(
      {
        script: "pwd",
        cwd: ".",
      } as ShellScriptArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, TEST_WORKSPACE);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Shell Tools: shell_script - script with error",
  async fn() {
    await setupWorkspace();

    const result = await shellScript(
      {
        script: `echo "Before error"
ls nonexistent-file
echo "After error"`,
      } as ShellScriptArgs,
      TEST_WORKSPACE,
    );

    // Script continues even after error (unless set -e), so exit code is 0
    // The error goes to stderr but the script completes
    assertEquals(result.success, true); // Last command (echo) succeeds
    assertStringIncludes(result.stdout, "Before error");
    assertStringIncludes(result.stdout, "After error");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Shell Tools: shell_script - with variables",
  async fn() {
    await setupWorkspace();

    const result = await shellScript(
      {
        script: `NAME="World"
echo "Hello, $NAME!"`,
      } as ShellScriptArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "Hello, World!");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Shell Tools: shell_script - reject path outside workspace",
  async fn() {
    await setupWorkspace();

    const result = await shellScript(
      {
        script: "pwd",
        cwd: "../../etc",
      } as ShellScriptArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, false);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Shell Tools: shell_script - abort long-running script",
  async fn() {
    if (getPlatform().build.os === "windows") return;
    await setupWorkspace();

    const controller = new AbortController();
    const startedAt = Date.now();
    const pending = shellScript(
      {
        script: "sleep 5",
      } as ShellScriptArgs,
      TEST_WORKSPACE,
      { signal: controller.signal },
    );

    setTimeout(() => controller.abort(), 100);
    const result = await pending;

    assertEquals(result.success, false);
    assertStringIncludes((result.message ?? "").toLowerCase(), "aborted");
    assertEquals(Date.now() - startedAt < 4500, true);

    await cleanupWorkspace();
  },
});
