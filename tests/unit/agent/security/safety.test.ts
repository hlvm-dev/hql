/**
 * Safety Classifier Tests
 *
 * Verifies safety classification and confirmation logic
 */

import { assertEquals } from "jsr:@std/assert";
import {
  classifyTool,
  hasL1Confirmation,
  setL1Confirmation,
  clearL1Confirmation,
  clearAllL1Confirmations,
  getAllL1Confirmations,
  checkToolSafety,
} from "../../../../src/hlvm/agent/security/safety.ts";

// ============================================================
// Classification tests
// ============================================================

Deno.test({
  name: "Safety: classifyTool - L0 read-only tools",
  fn() {
    // File read operations
    const readFile = classifyTool("read_file", { path: "src/main.ts" });
    assertEquals(readFile.level, "L0");

    const listFiles = classifyTool("list_files", { path: "src" });
    assertEquals(listFiles.level, "L0");

    // Code analysis operations
    const searchCode = classifyTool("search_code", { pattern: "test" });
    assertEquals(searchCode.level, "L0");

    const findSymbol = classifyTool("find_symbol", { name: "test" });
    assertEquals(findSymbol.level, "L0");

    const getStructure = classifyTool("get_structure", {});
    assertEquals(getStructure.level, "L0");
  },
});

Deno.test({
  name: "Safety: classifyTool - L1 shell allow-list",
  fn() {
    // git status
    const gitStatus = classifyTool("shell_exec", { command: "git status" });
    assertEquals(gitStatus.level, "L1");

    // git log
    const gitLog = classifyTool("shell_exec", { command: "git log" });
    assertEquals(gitLog.level, "L1");

    const gitLogOneline = classifyTool("shell_exec", {
      command: "git log --oneline",
    });
    assertEquals(gitLogOneline.level, "L1");

    // git diff
    const gitDiff = classifyTool("shell_exec", { command: "git diff" });
    assertEquals(gitDiff.level, "L1");

    const gitDiffHead = classifyTool("shell_exec", {
      command: "git diff HEAD",
    });
    assertEquals(gitDiffHead.level, "L1");

    // deno test --dry-run
    const denoDryRun = classifyTool("shell_exec", {
      command: "deno test --dry-run",
    });
    assertEquals(denoDryRun.level, "L1");
  },
});

Deno.test({
  name: "Safety: classifyTool - L2 destructive tools",
  fn() {
    // File write operations
    const writeFile = classifyTool("write_file", {
      path: "src/main.ts",
      content: "test",
    });
    assertEquals(writeFile.level, "L2");

    const deleteFile = classifyTool("delete_file", { path: "src/main.ts" });
    assertEquals(deleteFile.level, "L2");

    // Shell operations (non-allow-listed)
    const shellExec = classifyTool("shell_exec", { command: "rm -rf /" });
    assertEquals(shellExec.level, "L2");

    const shellScript = classifyTool("shell_script", { script: "echo test" });
    assertEquals(shellScript.level, "L2");
  },
});

Deno.test({
  name: "Safety: classifyTool - unknown tool defaults to L2",
  fn() {
    const unknown = classifyTool("unknown_tool", {});
    assertEquals(unknown.level, "L2");
    assertEquals(unknown.reason.includes("Unknown tool"), true);
  },
});

Deno.test({
  name: "Safety: classifyTool - shell_exec invalid args",
  fn() {
    // No command field
    const noCommand = classifyTool("shell_exec", {});
    assertEquals(noCommand.level, "L2");

    // Command not a string
    const badCommand = classifyTool("shell_exec", { command: 123 });
    assertEquals(badCommand.level, "L2");

    // Null args
    const nullArgs = classifyTool("shell_exec", null);
    assertEquals(nullArgs.level, "L2");
  },
});

Deno.test({
  name: "Safety: classifyTool - shell_exec whitespace handling",
  fn() {
    // Leading/trailing whitespace should be trimmed
    const withWhitespace = classifyTool("shell_exec", {
      command: "  git status  ",
    });
    assertEquals(withWhitespace.level, "L1");
  },
});

// ============================================================
// L1 Confirmation Tracking tests
// ============================================================

Deno.test({
  name: "Safety: L1 confirmation - initially empty",
  fn() {
    clearAllL1Confirmations();
    assertEquals(hasL1Confirmation("shell_exec", { command: "git status" }), false);
  },
});

Deno.test({
  name: "Safety: L1 confirmation - set and check (per-args)",
  fn() {
    clearAllL1Confirmations();

    const args1 = { command: "git status" };
    setL1Confirmation("shell_exec", args1);
    assertEquals(hasL1Confirmation("shell_exec", args1), true);

    // Other tools still not confirmed
    assertEquals(hasL1Confirmation("other_tool", {}), false);

    // Same tool with different args NOT confirmed (per-args behavior)
    assertEquals(hasL1Confirmation("shell_exec", { command: "git log" }), false);
  },
});

Deno.test({
  name: "Safety: L1 confirmation - clear single (per-args)",
  fn() {
    clearAllL1Confirmations();

    const args = { command: "git status" };
    setL1Confirmation("shell_exec", args);
    assertEquals(hasL1Confirmation("shell_exec", args), true);

    clearL1Confirmation("shell_exec", args);
    assertEquals(hasL1Confirmation("shell_exec", args), false);
  },
});

Deno.test({
  name: "Safety: L1 confirmation - clear all",
  fn() {
    clearAllL1Confirmations();

    const args1 = { id: 1 };
    const args2 = { id: 2 };
    const args3 = { id: 3 };

    setL1Confirmation("tool1", args1);
    setL1Confirmation("tool2", args2);
    setL1Confirmation("tool3", args3);

    assertEquals(hasL1Confirmation("tool1", args1), true);
    assertEquals(hasL1Confirmation("tool2", args2), true);
    assertEquals(hasL1Confirmation("tool3", args3), true);

    clearAllL1Confirmations();

    assertEquals(hasL1Confirmation("tool1", args1), false);
    assertEquals(hasL1Confirmation("tool2", args2), false);
    assertEquals(hasL1Confirmation("tool3", args3), false);
  },
});

Deno.test({
  name: "Safety: L1 confirmation - get all",
  fn() {
    clearAllL1Confirmations();

    const args1 = { id: 1 };
    const args2 = { id: 2 };

    setL1Confirmation("tool1", args1);
    setL1Confirmation("tool2", args2);

    const all = getAllL1Confirmations();
    assertEquals(all.size, 2);
    // Keys now include tool name + args
    assertEquals(all.get('tool1:{"id":1}'), true);
    assertEquals(all.get('tool2:{"id":2}'), true);
  },
});

Deno.test({
  name: "Safety: L1 confirmation - get all returns copy",
  fn() {
    clearAllL1Confirmations();

    setL1Confirmation("tool1", { id: 1 });

    const all1 = getAllL1Confirmations();
    const all2 = getAllL1Confirmations();

    // Should be different objects (not same reference)
    assertEquals(all1 !== all2, true);

    // But should have same content
    assertEquals(all1.size, all2.size);
  },
});

// ============================================================
// checkToolSafety tests (auto-approve mode)
// ============================================================

Deno.test({
  name: "Safety: checkToolSafety - auto-approve mode",
  async fn() {
    clearAllL1Confirmations();

    // All tools should be approved in auto-approve mode
    const l0Result = await checkToolSafety(
      "read_file",
      { path: "test.ts" },
      true,
    );
    assertEquals(l0Result, true);

    const l1Result = await checkToolSafety(
      "shell_exec",
      { command: "git status" },
      true,
    );
    assertEquals(l1Result, true);

    const l2Result = await checkToolSafety(
      "write_file",
      { path: "test.ts", content: "test" },
      true,
    );
    assertEquals(l2Result, true);
  },
});

Deno.test({
  name: "Safety: checkToolSafety - L0 auto-approved without prompt",
  async fn() {
    clearAllL1Confirmations();

    // L0 tools should be auto-approved even without auto-approve flag
    const result = await checkToolSafety(
      "read_file",
      { path: "test.ts" },
      false, // autoApprove = false, but should still approve L0
    );
    assertEquals(result, true);
  },
});

Deno.test({
  name: "Safety: checkToolSafety - L1 uses confirmation cache (per-args)",
  async fn() {
    clearAllL1Confirmations();

    const args = { command: "git status" };

    // Set L1 confirmation for specific args
    setL1Confirmation("shell_exec", args);

    // Should be approved without prompt (using cache)
    const result = await checkToolSafety(
      "shell_exec",
      args,
      false,
    );
    assertEquals(result, true);
  },
});

// ============================================================
// Edge cases and error handling
// ============================================================

Deno.test({
  name: "Safety: classifyTool - handles various shell commands",
  fn() {
    // Various git commands
    assertEquals(
      classifyTool("shell_exec", { command: "git status" }).level,
      "L1",
    );
    assertEquals(
      classifyTool("shell_exec", { command: "git log -10" }).level,
      "L1",
    );
    assertEquals(
      classifyTool("shell_exec", { command: "git diff main..dev" }).level,
      "L1",
    );

    // Non-allow-listed commands
    assertEquals(
      classifyTool("shell_exec", { command: "git push" }).level,
      "L2",
    );
    assertEquals(
      classifyTool("shell_exec", { command: "git commit" }).level,
      "L2",
    );
    assertEquals(
      classifyTool("shell_exec", { command: "echo hello" }).level,
      "L1",
    );
  },
});

Deno.test({
  name: "Safety: classifyTool - deno test without --dry-run is L2",
  fn() {
    // Without --dry-run flag
    const withoutFlag = classifyTool("shell_exec", {
      command: "deno test",
    });
    assertEquals(withoutFlag.level, "L2");

    // With --dry-run flag
    const withFlag = classifyTool("shell_exec", {
      command: "deno test --dry-run",
    });
    assertEquals(withFlag.level, "L1");

    // With path and --dry-run
    const withPath = classifyTool("shell_exec", {
      command: "deno test tests/ --dry-run",
    });
    assertEquals(withPath.level, "L1");
  },
});

Deno.test({
  name: "Safety: L1 confirmation - multiple tools independent (per-args)",
  fn() {
    clearAllL1Confirmations();

    const args1 = { id: 1 };
    const args2 = { id: 2 };

    setL1Confirmation("tool1", args1);
    setL1Confirmation("tool2", args2);

    assertEquals(hasL1Confirmation("tool1", args1), true);
    assertEquals(hasL1Confirmation("tool2", args2), true);

    clearL1Confirmation("tool1", args1);

    assertEquals(hasL1Confirmation("tool1", args1), false);
    assertEquals(hasL1Confirmation("tool2", args2), true);
  },
});

Deno.test({
  name: "Safety: classifyTool - provides meaningful reasons",
  fn() {
    const l0 = classifyTool("read_file", { path: "test.ts" });
    assertEquals(l0.reason.length > 0, true);
    assertEquals(l0.reason.includes("Read-only"), true);

    const l1 = classifyTool("shell_exec", { command: "git status" });
    assertEquals(l1.reason.length > 0, true);
    assertEquals(l1.reason.includes("Allow-listed"), true);

    const l2 = classifyTool("write_file", {
      path: "test.ts",
      content: "test",
    });
    assertEquals(l2.reason.length > 0, true);
    assertEquals(l2.reason.includes("Destructive"), true);
  },
});
