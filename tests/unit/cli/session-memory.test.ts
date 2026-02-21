/**
 * Session Memory Tests
 *
 * Tests production session-memory helpers used by chat handler:
 * - enablement default behavior
 * - metadata parsing
 * - command construction
 * - init event session_id capture
 */

import { assertEquals, assert } from "jsr:@std/assert";
import {
  buildClaudeCodeCommand,
  captureSessionIdFromInitEvent,
  isSessionMemoryEnabled,
  parseSessionMemoryMetadata,
  _resetClaudeBinaryCache,
} from "../../../src/hlvm/cli/repl/handlers/session-memory.ts";

// ============================================================
// Enablement
// ============================================================

Deno.test("isSessionMemoryEnabled - defaults to ON unless explicitly false", () => {
  assertEquals(isSessionMemoryEnabled(undefined), true);
  assertEquals(isSessionMemoryEnabled(true), true);
  assertEquals(isSessionMemoryEnabled(false), false);
});

// ============================================================
// Metadata parsing
// ============================================================

Deno.test("parseSessionMemoryMetadata - empty metadata", () => {
  const parsed = parseSessionMemoryMetadata(null);
  assertEquals(parsed.existingMeta, {});
  assertEquals(parsed.claudeCodeSessionId, null);
});

Deno.test("parseSessionMemoryMetadata - malformed JSON", () => {
  const parsed = parseSessionMemoryMetadata("not valid json {{{");
  assertEquals(parsed.existingMeta, {});
  assertEquals(parsed.claudeCodeSessionId, null);
});

Deno.test("parseSessionMemoryMetadata - extracts stored session id", () => {
  const parsed = parseSessionMemoryMetadata(
    JSON.stringify({ claudeCodeSessionId: "test-uuid-123", otherField: 42 }),
  );
  assertEquals(parsed.existingMeta, { claudeCodeSessionId: "test-uuid-123", otherField: 42 });
  assertEquals(parsed.claudeCodeSessionId, "test-uuid-123");
});

Deno.test("parseSessionMemoryMetadata - ignores non-string stored session id", () => {
  const parsed = parseSessionMemoryMetadata(JSON.stringify({ claudeCodeSessionId: 12345 }));
  assertEquals(parsed.existingMeta, { claudeCodeSessionId: 12345 });
  assertEquals(parsed.claudeCodeSessionId, null);
});

// ============================================================
// Command building logic
// ============================================================

Deno.test("buildClaudeCodeCommand - fresh session (no --resume)", () => {
  _resetClaudeBinaryCache();
  const cmd = buildClaudeCodeCommand("list files", null);
  // Binary may be an absolute path (e.g. ~/.local/bin/claude) or bare "claude"
  assert(cmd[0].endsWith("claude"), `expected binary ending with 'claude', got '${cmd[0]}'`);
  assertEquals(cmd.slice(1), ["-p", "list files", "--output-format", "stream-json", "--verbose"]);
});

Deno.test("buildClaudeCodeCommand - resume with stored ID", () => {
  _resetClaudeBinaryCache();
  const cmd = buildClaudeCodeCommand("delete the first one", "abc-123-uuid");
  assert(cmd[0].endsWith("claude"), `expected binary ending with 'claude', got '${cmd[0]}'`);
  assertEquals(cmd.slice(1), ["--resume", "abc-123-uuid", "-p", "delete the first one", "--output-format", "stream-json", "--verbose"]);
});

// ============================================================
// Init event parsing
// ============================================================

Deno.test("captureSessionIdFromInitEvent - stores new session_id", () => {
  const existingMeta: Record<string, unknown> = {};
  const changed = captureSessionIdFromInitEvent(
    { type: "system", subtype: "init", session_id: "new-session-uuid" },
    true,
    null,
    existingMeta,
  );
  assertEquals(changed, true);
  assertEquals(existingMeta.claudeCodeSessionId, "new-session-uuid");
});

Deno.test("captureSessionIdFromInitEvent - skips unchanged session_id", () => {
  const existingMeta: Record<string, unknown> = {};
  const changed = captureSessionIdFromInitEvent(
    { type: "system", subtype: "init", session_id: "already-stored" },
    true,
    "already-stored",
    existingMeta,
  );
  assertEquals(changed, false);
  assertEquals(existingMeta.claudeCodeSessionId, undefined);
});

Deno.test("captureSessionIdFromInitEvent - ignores unrelated events", () => {
  const existingMeta: Record<string, unknown> = {};
  const changed = captureSessionIdFromInitEvent(
    { type: "assistant", message: { content: [] } },
    true,
    null,
    existingMeta,
  );
  assertEquals(changed, false);
  assertEquals(existingMeta.claudeCodeSessionId, undefined);
});

Deno.test("captureSessionIdFromInitEvent - disabled session memory", () => {
  const existingMeta: Record<string, unknown> = {};
  const changed = captureSessionIdFromInitEvent(
    { type: "system", subtype: "init", session_id: "new-session-uuid" },
    false,
    null,
    existingMeta,
  );
  assertEquals(changed, false);
  assertEquals(existingMeta.claudeCodeSessionId, undefined);
});
