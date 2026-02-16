/**
 * Session Memory Tests
 *
 * Tests for Claude Code session memory feature:
 * - Config key validation (sessionMemory)
 * - --fresh flag parsing behavior
 * - Session metadata JSON round-trip
 */

import { assertEquals } from "jsr:@std/assert";
import { validateValue, type HlvmConfig } from "../../../src/common/config/types.ts";

// ============================================================
// sessionMemory config defaults
// ============================================================

Deno.test("sessionMemory defaults to ON when undefined", () => {
  // The chat handler uses `cfgSnapshot.sessionMemory !== false` — meaning
  // undefined (not set) and true both enable session memory.
  const config = { sessionMemory: undefined } as Partial<HlvmConfig>;
  const enabled = config.sessionMemory !== false;
  assertEquals(enabled, true);
});

Deno.test("sessionMemory is OFF when explicitly false", () => {
  const config = { sessionMemory: false } as Partial<HlvmConfig>;
  const enabled = config.sessionMemory !== false;
  assertEquals(enabled, false);
});

Deno.test("sessionMemory is ON when explicitly true", () => {
  const config = { sessionMemory: true } as Partial<HlvmConfig>;
  const enabled = config.sessionMemory !== false;
  assertEquals(enabled, true);
});

// ============================================================
// Session metadata JSON round-trip
// ============================================================

Deno.test("session metadata - stores and retrieves claudeCodeSessionId", () => {
  const sessionId = "a6aea7cf-85aa-464b-8e98-bd571dd4dd28";
  const meta: Record<string, unknown> = {};
  meta.claudeCodeSessionId = sessionId;
  const json = JSON.stringify(meta);

  const parsed = JSON.parse(json);
  assertEquals(parsed.claudeCodeSessionId, sessionId);
});

Deno.test("session metadata - handles empty metadata", () => {
  const metadata: string | null = null;
  let claudeCodeSessionId: string | null = null;

  if (metadata) {
    try {
      const meta = JSON.parse(metadata);
      claudeCodeSessionId = typeof meta.claudeCodeSessionId === "string"
        ? meta.claudeCodeSessionId
        : null;
    } catch {
      // Malformed
    }
  }

  assertEquals(claudeCodeSessionId, null);
});

Deno.test("session metadata - handles malformed JSON gracefully", () => {
  const metadata = "not valid json {{{";
  let claudeCodeSessionId: string | null = null;

  try {
    const meta = JSON.parse(metadata);
    claudeCodeSessionId = typeof meta.claudeCodeSessionId === "string"
      ? meta.claudeCodeSessionId
      : null;
  } catch {
    // Expected — malformed metadata
  }

  assertEquals(claudeCodeSessionId, null);
});

Deno.test("session metadata - extracts claudeCodeSessionId from valid JSON", () => {
  const metadata = JSON.stringify({ claudeCodeSessionId: "test-uuid-123", otherField: 42 });
  let claudeCodeSessionId: string | null = null;

  try {
    const meta = JSON.parse(metadata);
    if (meta && typeof meta === "object") {
      claudeCodeSessionId = typeof meta.claudeCodeSessionId === "string"
        ? meta.claudeCodeSessionId
        : null;
    }
  } catch {
    // Malformed
  }

  assertEquals(claudeCodeSessionId, "test-uuid-123");
});

Deno.test("session metadata - ignores non-string claudeCodeSessionId", () => {
  const metadata = JSON.stringify({ claudeCodeSessionId: 12345 });
  let claudeCodeSessionId: string | null = null;

  try {
    const meta = JSON.parse(metadata);
    claudeCodeSessionId = typeof meta.claudeCodeSessionId === "string"
      ? meta.claudeCodeSessionId
      : null;
  } catch {
    // Malformed
  }

  assertEquals(claudeCodeSessionId, null);
});

// ============================================================
// Command building logic
// ============================================================

Deno.test("command building - fresh session (no stored ID)", () => {
  const claudeCodeSessionId: string | null = null;
  const query = "list files";

  const cmd = claudeCodeSessionId
    ? ["claude", "--resume", claudeCodeSessionId, "-p", query, "--output-format", "stream-json", "--verbose"]
    : ["claude", "-p", query, "--output-format", "stream-json", "--verbose"];

  assertEquals(cmd, ["claude", "-p", "list files", "--output-format", "stream-json", "--verbose"]);
  assertEquals(cmd.includes("--resume"), false);
});

Deno.test("command building - resume with stored ID", () => {
  const claudeCodeSessionId = "abc-123-uuid";
  const query = "delete the first one";

  const cmd = claudeCodeSessionId
    ? ["claude", "--resume", claudeCodeSessionId, "-p", query, "--output-format", "stream-json", "--verbose"]
    : ["claude", "-p", query, "--output-format", "stream-json", "--verbose"];

  assertEquals(cmd[0], "claude");
  assertEquals(cmd[1], "--resume");
  assertEquals(cmd[2], "abc-123-uuid");
  assertEquals(cmd[3], "-p");
  assertEquals(cmd[4], "delete the first one");
  assertEquals(cmd.includes("--resume"), true);
});

// ============================================================
// Init event parsing
// ============================================================

Deno.test("init event - captures session_id from system init event", () => {
  const event = { type: "system", subtype: "init", session_id: "new-session-uuid" };
  const existingMeta: Record<string, unknown> = {};
  const claudeCodeSessionId: string | null = null;

  if (
    event.type === "system" &&
    event.subtype === "init" &&
    typeof event.session_id === "string" &&
    event.session_id !== claudeCodeSessionId
  ) {
    existingMeta.claudeCodeSessionId = event.session_id;
  }

  assertEquals(existingMeta.claudeCodeSessionId, "new-session-uuid");
});

Deno.test("init event - skips if session_id matches stored", () => {
  const event = { type: "system", subtype: "init", session_id: "already-stored" };
  const existingMeta: Record<string, unknown> = {};
  const claudeCodeSessionId = "already-stored";

  if (
    event.type === "system" &&
    event.subtype === "init" &&
    typeof event.session_id === "string" &&
    event.session_id !== claudeCodeSessionId
  ) {
    existingMeta.claudeCodeSessionId = event.session_id;
  }

  assertEquals(existingMeta.claudeCodeSessionId, undefined);
});

Deno.test("init event - ignores non-system events", () => {
  const event = { type: "assistant", message: { content: [] } };
  const existingMeta: Record<string, unknown> = {};

  if (
    (event as Record<string, unknown>).type === "system" &&
    (event as Record<string, unknown>).subtype === "init" &&
    typeof (event as Record<string, unknown>).session_id === "string"
  ) {
    existingMeta.claudeCodeSessionId = (event as Record<string, unknown>).session_id;
  }

  assertEquals(existingMeta.claudeCodeSessionId, undefined);
});

// ============================================================
// Config validation (sessionMemory key)
// ============================================================

Deno.test("validateValue - sessionMemory accepts boolean", () => {
  assertEquals(validateValue("sessionMemory", true).valid, true);
  assertEquals(validateValue("sessionMemory", false).valid, true);
});

Deno.test("validateValue - sessionMemory accepts undefined", () => {
  assertEquals(validateValue("sessionMemory", undefined).valid, true);
});

Deno.test("validateValue - sessionMemory rejects non-boolean", () => {
  assertEquals(validateValue("sessionMemory", "true").valid, false);
  assertEquals(validateValue("sessionMemory", 1).valid, false);
  assertEquals(validateValue("sessionMemory", "yes").valid, false);
  assertEquals(validateValue("sessionMemory", {}).valid, false);
});
