import { assertEquals } from "jsr:@std/assert";
import { resolveToolPermission } from "../../../../src/hlvm/agent/security/safety.ts";
import type { ToolPermissions } from "../../../../src/common/config/types.ts";

Deno.test("resolveToolPermission: explicit deny takes precedence over allow", () => {
  const permissions: ToolPermissions = {
    allowedTools: new Set(["write_file"]),
    deniedTools: new Set(["write_file"]),
    mode: "default",
  };
  assertEquals(resolveToolPermission("write_file", "L1", permissions), "deny");
});

Deno.test("resolveToolPermission: explicit allow overrides mode defaults", () => {
  const permissions: ToolPermissions = {
    allowedTools: new Set(["shell_exec"]),
    deniedTools: new Set(),
    mode: "dontAsk",
  };
  // shell_exec is L2, dontAsk would normally deny, but explicit allow wins
  assertEquals(resolveToolPermission("shell_exec", "L2", permissions), "allow");
});

Deno.test("resolveToolPermission: dontAsk mode allows L0, denies L1/L2", () => {
  const permissions: ToolPermissions = {
    allowedTools: new Set(),
    deniedTools: new Set(),
    mode: "dontAsk",
  };
  assertEquals(resolveToolPermission("read_file", "L0", permissions), "allow");
  assertEquals(resolveToolPermission("write_file", "L1", permissions), "deny");
  assertEquals(resolveToolPermission("shell_exec", "L2", permissions), "deny");
});

Deno.test("resolveToolPermission: bypassPermissions mode allows everything", () => {
  const permissions: ToolPermissions = {
    allowedTools: new Set(),
    deniedTools: new Set(),
    mode: "bypassPermissions",
  };
  assertEquals(resolveToolPermission("read_file", "L0", permissions), "allow");
  assertEquals(resolveToolPermission("write_file", "L1", permissions), "allow");
  assertEquals(resolveToolPermission("shell_exec", "L2", permissions), "allow");
});

Deno.test("resolveToolPermission: acceptEdits mode allows L0+L1, prompts L2", () => {
  const permissions: ToolPermissions = {
    allowedTools: new Set(),
    deniedTools: new Set(),
    mode: "acceptEdits",
  };
  assertEquals(resolveToolPermission("read_file", "L0", permissions), "allow");
  assertEquals(resolveToolPermission("write_file", "L1", permissions), "allow");
  assertEquals(resolveToolPermission("delete_file", "L2", permissions), "prompt");
});

Deno.test("resolveToolPermission: default mode auto-approves L0, prompts L1/L2", () => {
  const permissions: ToolPermissions = {
    allowedTools: new Set(),
    deniedTools: new Set(),
    mode: "default",
  };
  assertEquals(resolveToolPermission("read_file", "L0", permissions), "allow");
  assertEquals(resolveToolPermission("write_file", "L1", permissions), "prompt");
  assertEquals(resolveToolPermission("delete_file", "L2", permissions), "prompt");
});

Deno.test("resolveToolPermission: priority order verification", () => {
  // Test the documented priority: deny > allow > mode
  const permissions: ToolPermissions = {
    allowedTools: new Set(["tool_a"]),
    deniedTools: new Set(["tool_a", "tool_b"]),
    mode: "bypassPermissions",
  };

  // Priority 1: Explicit deny wins over allow
  assertEquals(resolveToolPermission("tool_a", "L1", permissions), "deny");

  // Priority 2: Explicit allow wins over mode
  const permissions2: ToolPermissions = {
    allowedTools: new Set(["tool_b"]),
    deniedTools: new Set(),
    mode: "dontAsk",
  };
  assertEquals(resolveToolPermission("tool_b", "L2", permissions2), "allow");

  // Priority 3: Mode applies when no explicit rules
  assertEquals(resolveToolPermission("tool_c", "L0", permissions2), "allow");
  assertEquals(resolveToolPermission("tool_c", "L1", permissions2), "deny");
});

Deno.test("resolveToolPermission: edge cases with empty sets", () => {
  const permissions: ToolPermissions = {
    allowedTools: new Set(),
    deniedTools: new Set(),
    mode: "default",
  };

  // With empty sets and default mode, should return prompt
  assertEquals(resolveToolPermission("any_tool", "L1", permissions), "prompt");
  assertEquals(resolveToolPermission("any_tool", "L2", permissions), "prompt");
});

// ── Auto mode tests ──

Deno.test("resolveToolPermission: auto mode auto-approves L0", () => {
  const p: ToolPermissions = { allowedTools: new Set(), deniedTools: new Set(), mode: "auto" };
  assertEquals(resolveToolPermission("read_file", "L0", p), "allow");
});

Deno.test("resolveToolPermission: auto mode returns auto-classify for L1", () => {
  const p: ToolPermissions = { allowedTools: new Set(), deniedTools: new Set(), mode: "auto" };
  assertEquals(resolveToolPermission("write_file", "L1", p), "auto-classify");
});

Deno.test("resolveToolPermission: auto mode returns auto-classify for L2", () => {
  const p: ToolPermissions = { allowedTools: new Set(), deniedTools: new Set(), mode: "auto" };
  assertEquals(resolveToolPermission("shell_exec", "L2", p), "auto-classify");
});

Deno.test("resolveToolPermission: explicit deny overrides auto mode", () => {
  const p: ToolPermissions = { allowedTools: new Set(), deniedTools: new Set(["shell_exec"]), mode: "auto" };
  assertEquals(resolveToolPermission("shell_exec", "L2", p), "deny");
});

Deno.test("resolveToolPermission: explicit allow overrides auto mode", () => {
  const p: ToolPermissions = { allowedTools: new Set(["shell_exec"]), deniedTools: new Set(), mode: "auto" };
  assertEquals(resolveToolPermission("shell_exec", "L2", p), "allow");
});
