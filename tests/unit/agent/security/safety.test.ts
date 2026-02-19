/**
 * Safety Classifier Tests
 *
 * Verifies safety classification and confirmation logic
 */

import { assertEquals } from "jsr:@std/assert";
import {
  checkToolSafety,
  classifyTool,
  clearAllL1Confirmations,
  clearL1Confirmation,
  getAllL1Confirmations,
  hasL1Confirmation,
  setL1Confirmation,
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
  name: "Safety: classifyTool - L0 read-only shell commands",
  fn() {
    assertEquals(classifyTool("shell_exec", { command: "git status" }).level, "L0");
    assertEquals(classifyTool("shell_exec", { command: "git log" }).level, "L0");
    assertEquals(classifyTool("shell_exec", { command: "git log --oneline" }).level, "L0");
    assertEquals(classifyTool("shell_exec", { command: "git diff" }).level, "L0");
    assertEquals(classifyTool("shell_exec", { command: "git diff HEAD" }).level, "L0");
  },
});

Deno.test({
  name: "Safety: classifyTool - L1 shell allow-list",
  fn() {
    const denoDryRun = classifyTool("shell_exec", {
      command: "deno test --dry-run",
    });
    assertEquals(denoDryRun.level, "L1");
  },
});

Deno.test({
  name: "Safety: classifyTool - L2 destructive tools",
  fn() {
    // File write operations (L1: prompt once per session, like Claude Code)
    const writeFile = classifyTool("write_file", {
      path: "src/main.ts",
      content: "test",
    });
    assertEquals(writeFile.level, "L1");

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
    assertEquals(withWhitespace.level, "L0");
  },
});

// ============================================================
// L1 Confirmation Tracking tests
// ============================================================

Deno.test({
  name: "Safety: L1 confirmation - initially empty",
  fn() {
    clearAllL1Confirmations();
    assertEquals(
      hasL1Confirmation("shell_exec", { command: "git status" }),
      false,
    );
  },
});

Deno.test({
  name: "Safety: L1 confirmation - shell_exec remains per-args",
  fn() {
    clearAllL1Confirmations();

    const args1 = { command: "git status" };
    setL1Confirmation("shell_exec", args1);
    assertEquals(hasL1Confirmation("shell_exec", args1), true);

    // Other tools still not confirmed
    assertEquals(hasL1Confirmation("other_tool", {}), false);

    // Same tool with different args NOT confirmed (per-args behavior)
    assertEquals(
      hasL1Confirmation("shell_exec", { command: "git log" }),
      false,
    );
  },
});

Deno.test({
  name: "Safety: L1 confirmation - non-shell tools are per-tool",
  fn() {
    clearAllL1Confirmations();
    setL1Confirmation("web_fetch", { url: "https://example.com/a" });
    assertEquals(
      hasL1Confirmation("web_fetch", { url: "https://example.com/b" }),
      true,
    );
  },
});

Deno.test({
  name: "Safety: L1 confirmation - isolated per session store",
  fn() {
    const storeA = new Map<string, boolean>();
    const storeB = new Map<string, boolean>();
    const args = { command: "git status" };

    setL1Confirmation("shell_exec", args, storeA);
    assertEquals(hasL1Confirmation("shell_exec", args, storeA), true);
    assertEquals(hasL1Confirmation("shell_exec", args, storeB), false);
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
    assertEquals(all.get("tool1"), true);
    assertEquals(all.get("tool2"), true);
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
    const store = new Map<string, boolean>();

    // All tools should be approved in auto-approve mode
    const l0Result = await checkToolSafety(
      "read_file",
      { path: "test.ts" },
      true,
      null,
      store,
    );
    assertEquals(l0Result, true);

    const l1Result = await checkToolSafety(
      "shell_exec",
      { command: "git status" },
      true,
      null,
      store,
    );
    assertEquals(l1Result, true);

    const l2Result = await checkToolSafety(
      "write_file",
      { path: "test.ts", content: "test" },
      true,
      null,
      store,
    );
    assertEquals(l2Result, true);
  },
});

Deno.test({
  name: "Safety: checkToolSafety - L0 auto-approved without prompt",
  async fn() {
    clearAllL1Confirmations();
    const store = new Map<string, boolean>();

    // L0 tools should be auto-approved even without auto-approve flag
    const result = await checkToolSafety(
      "read_file",
      { path: "test.ts" },
      false, // autoApprove = false, but should still approve L0
      null,
      store,
    );
    assertEquals(result, true);
  },
});

Deno.test({
  name: "Safety: checkToolSafety - L1 uses confirmation cache (per-args)",
  async fn() {
    clearAllL1Confirmations();
    const store = new Map<string, boolean>();

    const args = { command: "git status" };

    // Set L1 confirmation for specific args
    setL1Confirmation("shell_exec", args, store);

    // Should be approved without prompt (using cache)
    const result = await checkToolSafety(
      "shell_exec",
      args,
      false,
      null,
      store,
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
    // Read-only git commands → L0
    assertEquals(
      classifyTool("shell_exec", { command: "git status" }).level,
      "L0",
    );
    assertEquals(
      classifyTool("shell_exec", { command: "git log -10" }).level,
      "L0",
    );
    assertEquals(
      classifyTool("shell_exec", { command: "git diff main..dev" }).level,
      "L0",
    );
    assertEquals(
      classifyTool("shell_exec", { command: "echo hello" }).level,
      "L0",
    );

    // Non-allow-listed commands → L2
    assertEquals(
      classifyTool("shell_exec", { command: "git push" }).level,
      "L2",
    );
    assertEquals(
      classifyTool("shell_exec", { command: "git commit" }).level,
      "L2",
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
  name: "Safety: L1 confirmation - 'always' remembers via setL1Confirmation",
  fn() {
    clearAllL1Confirmations();

    // Simulate "always" behavior: L1 tool gets remembered
    const args = { command: "git status" };
    setL1Confirmation("shell_exec", args);

    // Future calls auto-approved
    assertEquals(hasL1Confirmation("shell_exec", args), true);

    // Verify the cache persists for the session
    const all = getAllL1Confirmations();
    assertEquals(all.size >= 1, true);
  },
});

Deno.test({
  name: "Safety: classifyTool - git tools classified correctly",
  fn() {
    // New git tools should have correct safety levels
    const gitStatus = classifyTool("git_status", {});
    assertEquals(gitStatus.level, "L0");

    const gitDiff = classifyTool("git_diff", {});
    assertEquals(gitDiff.level, "L0");

    const gitLog = classifyTool("git_log", {});
    assertEquals(gitLog.level, "L0");

    const gitCommit = classifyTool("git_commit", { message: "test" });
    assertEquals(gitCommit.level, "L2");

    const memoryClear = classifyTool("memory_clear", {});
    assertEquals(memoryClear.level, "L2");
  },
});

Deno.test({
  name: "Safety: classifyTool - provides meaningful reasons",
  fn() {
    const l0 = classifyTool("read_file", { path: "test.ts" });
    assertEquals(l0.reason.length > 0, true);
    assertEquals(l0.reason.includes("Read-only"), true);

    const l0Shell = classifyTool("shell_exec", { command: "git status" });
    assertEquals(l0Shell.reason.length > 0, true);
    assertEquals(l0Shell.reason.includes("Read-only"), true);

    const l1Write = classifyTool("write_file", {
      path: "test.ts",
      content: "test",
    });
    assertEquals(l1Write.reason.length > 0, true);
  },
});
