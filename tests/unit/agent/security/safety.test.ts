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
import { classifyShellPipeline } from "../../../../src/hlvm/agent/security/shell-classifier.ts";
import type { AgentPolicy } from "../../../../src/hlvm/agent/policy.ts";

Deno.test("Safety: classifyTool covers representative metadata-backed tool families", () => {
  assertEquals(classifyTool("read_file", { path: "src/main.ts" }).level, "L0");
  assertEquals(classifyTool("git_status", {}).level, "L0");
  assertEquals(classifyTool("memory_write", { content: "note" }).level, "L0");
  assertEquals(classifyTool("write_file", { path: "src/main.ts", content: "x" }).level, "L1");
  assertEquals(classifyTool("delete_file", { path: "src/main.ts" }).level, "L2");
  assertEquals(classifyTool("unknown_tool", {}).level, "L2");
});

Deno.test("Safety: classifyTool applies shell allowlists, trims whitespace, and rejects invalid shell args", () => {
  assertEquals(classifyTool("shell_exec", { command: "git status" }).level, "L0");
  assertEquals(classifyTool("shell_exec", { command: "  git status  " }).level, "L0");
  assertEquals(
    classifyTool("shell_exec", { command: "sed -n '340,370p' src/app.ts" }).level,
    "L0",
  );
  assertEquals(classifyTool("shell_exec", { command: "deno test --dry-run" }).level, "L1");
  assertEquals(classifyTool("shell_exec", { command: "git push" }).level, "L2");
  assertEquals(classifyTool("shell_exec", {}).level, "L2");
  assertEquals(classifyTool("shell_exec", null).level, "L2");
});

Deno.test("Safety: L1 confirmation store is per-args for shell_exec and per-tool for other tools", () => {
  clearAllL1Confirmations();

  setL1Confirmation("shell_exec", { command: "git status" });
  assertEquals(hasL1Confirmation("shell_exec", { command: "git status" }), true);
  assertEquals(hasL1Confirmation("shell_exec", { command: "git log" }), false);

  setL1Confirmation("web_fetch", { url: "https://example.com/a" });
  assertEquals(hasL1Confirmation("web_fetch", { url: "https://example.com/b" }), true);

  clearL1Confirmation("shell_exec", { command: "git status" });
  assertEquals(hasL1Confirmation("shell_exec", { command: "git status" }), false);

  const snapshotA = getAllL1Confirmations();
  const snapshotB = getAllL1Confirmations();
  assertEquals(snapshotA === snapshotB, false);
  clearAllL1Confirmations();
  assertEquals(getAllL1Confirmations().size, 0);
});

Deno.test("Safety: checkToolSafety respects policy overrides before permission mode logic", async () => {
  const denyPolicy: AgentPolicy = { version: 1, toolRules: { write_file: "deny" } };
  const allowPolicy: AgentPolicy = { version: 1, toolRules: { write_file: "allow" } };
  const store = new Map<string, boolean>();

  assertEquals(
    await checkToolSafety("write_file", { path: "a", content: "b" }, "default", denyPolicy, store),
    false,
  );
  assertEquals(
    await checkToolSafety("write_file", { path: "a", content: "b" }, "default", allowPolicy, store),
    true,
  );
});

Deno.test("Safety: permission modes auto-approve the intended levels", async () => {
  const store = new Map<string, boolean>();

  assertEquals(
    await checkToolSafety("write_file", { path: "a", content: "b" }, "yolo", null, store),
    true,
  );
  assertEquals(
    await checkToolSafety("shell_exec", { command: "deno test --dry-run" }, "auto-edit", null, store),
    true,
  );
  assertEquals(
    await checkToolSafety("read_file", { path: "a" }, "default", null, store),
    true,
  );
});

Deno.test("Safety: default-mode L1 prompts once and then uses the confirmation cache", async () => {
  clearAllL1Confirmations();
  const store = new Map<string, boolean>();
  let prompts = 0;
  const onInteraction = async () => {
    prompts++;
    return { approved: true, rememberChoice: true };
  };

  assertEquals(
    await checkToolSafety(
      "shell_exec",
      { command: "deno test --dry-run" },
      "default",
      null,
      store,
      undefined,
      onInteraction,
    ),
    true,
  );
  assertEquals(hasL1Confirmation("shell_exec", { command: "deno test --dry-run" }, store), true);

  assertEquals(
    await checkToolSafety(
      "shell_exec",
      { command: "deno test --dry-run" },
      "default",
      null,
      store,
    ),
    true,
  );
  assertEquals(prompts, 1);
});

Deno.test("Safety: default-mode L2 always prompts and never persists confirmation", async () => {
  clearAllL1Confirmations();
  const store = new Map<string, boolean>();
  let prompts = 0;
  const onInteraction = async () => {
    prompts++;
    return { approved: true, rememberChoice: true };
  };

  assertEquals(
    await checkToolSafety(
      "delete_file",
      { path: "src/main.ts" },
      "default",
      null,
      store,
      undefined,
      onInteraction,
    ),
    true,
  );
  assertEquals(
    await checkToolSafety(
      "delete_file",
      { path: "src/main.ts" },
      "default",
      null,
      store,
      undefined,
      onInteraction,
    ),
    true,
  );
  assertEquals(prompts, 2);
  assertEquals(getAllL1Confirmations(store).size, 0);
});

// ---------------------------------------------------------------------------
// classifyShellPipeline: pipeline-aware classification
// ---------------------------------------------------------------------------

Deno.test("Safety: classifyShellPipeline classifies read-only pipelines as L0", () => {
  assertEquals(classifyShellPipeline("du -sh /tmp | sort -r").level, "L0");
  assertEquals(classifyShellPipeline("cat file 2>/dev/null | grep err").level, "L0");
});

Deno.test("Safety: classifyShellPipeline classifies file redirects as L2", () => {
  assertEquals(classifyShellPipeline("ls > output.txt").level, "L2");
});

Deno.test("Safety: classifyShellPipeline classifies chaining operators as L2", () => {
  assertEquals(classifyShellPipeline("echo hello && rm file").level, "L2");
});

Deno.test("Safety: classifyShellPipeline falls back to simple classification for non-metachar commands", () => {
  assertEquals(classifyShellPipeline("git status").level, "L0");
  assertEquals(classifyShellPipeline("git push").level, "L2");
});
