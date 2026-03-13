import { assertEquals } from "jsr:@std/assert";
import {
  captureSessionIdFromInitEvent,
  resolveSessionMemoryEnabled,
} from "../../../src/hlvm/cli/repl/handlers/session-memory.ts";

Deno.test("session memory: request disable flag overrides Claude Code config", () => {
  assertEquals(resolveSessionMemoryEnabled(undefined, undefined), true);
  assertEquals(resolveSessionMemoryEnabled(true, undefined), true);
  assertEquals(resolveSessionMemoryEnabled(false, undefined), false);
  assertEquals(resolveSessionMemoryEnabled(true, true), false);
  assertEquals(resolveSessionMemoryEnabled(undefined, true), false);
});

Deno.test("session memory: disabled session memory never captures a Claude session id", () => {
  const metadata: Record<string, unknown> = {};
  const updated = captureSessionIdFromInitEvent(
    {
      type: "system",
      subtype: "init",
      session_id: "claude-session-123",
    },
    false,
    null,
    metadata,
  );

  assertEquals(updated, false);
  assertEquals("claudeCodeSessionId" in metadata, false);
});
