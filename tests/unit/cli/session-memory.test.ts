import { assert, assertEquals } from "jsr:@std/assert";
import {
  _resetClaudeBinaryCache,
  buildClaudeCodeCommand,
  captureSessionIdFromInitEvent,
  isSessionMemoryEnabled,
  parseSessionMemoryMetadata,
} from "../../../src/hlvm/cli/repl/handlers/session-memory.ts";

Deno.test("session memory: enablement defaults on and only disables when explicitly false", () => {
  assertEquals(isSessionMemoryEnabled(undefined), true);
  assertEquals(isSessionMemoryEnabled(true), true);
  assertEquals(isSessionMemoryEnabled(false), false);
});

Deno.test("session memory: metadata parsing tolerates empty or malformed values and extracts valid stored ids", () => {
  assertEquals(parseSessionMemoryMetadata(null), {
    existingMeta: {},
    claudeCodeSessionId: null,
  });
  assertEquals(parseSessionMemoryMetadata("not valid json {{{"), {
    existingMeta: {},
    claudeCodeSessionId: null,
  });
  assertEquals(
    parseSessionMemoryMetadata(
      JSON.stringify({ claudeCodeSessionId: "test-uuid-123", otherField: 42 }),
    ),
    {
      existingMeta: { claudeCodeSessionId: "test-uuid-123", otherField: 42 },
      claudeCodeSessionId: "test-uuid-123",
    },
  );
  assertEquals(
    parseSessionMemoryMetadata(JSON.stringify({ claudeCodeSessionId: 12345 })),
    {
      existingMeta: { claudeCodeSessionId: 12345 },
      claudeCodeSessionId: null,
    },
  );
});

Deno.test("session memory: Claude command building distinguishes fresh and resumed sessions", () => {
  _resetClaudeBinaryCache();
  const fresh = buildClaudeCodeCommand("list files", null);
  const resumed = buildClaudeCodeCommand("delete the first one", "abc-123-uuid");

  assert(fresh[0].endsWith("claude"));
  assertEquals(fresh.slice(1), ["-p", "list files", "--output-format", "stream-json", "--verbose"]);
  assert(resumed[0].endsWith("claude"));
  assertEquals(resumed.slice(1), [
    "--resume",
    "abc-123-uuid",
    "-p",
    "delete the first one",
    "--output-format",
    "stream-json",
    "--verbose",
  ]);
});

Deno.test("session memory: init events store new session ids but ignore unchanged, unrelated, or disabled cases", () => {
  const storedMeta: Record<string, unknown> = {};
  const stored = captureSessionIdFromInitEvent(
    { type: "system", subtype: "init", session_id: "new-session-uuid" },
    true,
    null,
    storedMeta,
  );

  const unchangedMeta: Record<string, unknown> = {};
  const unchanged = captureSessionIdFromInitEvent(
    { type: "system", subtype: "init", session_id: "already-stored" },
    true,
    "already-stored",
    unchangedMeta,
  );

  const unrelatedMeta: Record<string, unknown> = {};
  const unrelated = captureSessionIdFromInitEvent(
    { type: "assistant", message: { content: [] } },
    true,
    null,
    unrelatedMeta,
  );

  const disabledMeta: Record<string, unknown> = {};
  const disabled = captureSessionIdFromInitEvent(
    { type: "system", subtype: "init", session_id: "new-session-uuid" },
    false,
    null,
    disabledMeta,
  );

  assertEquals(stored, true);
  assertEquals(storedMeta.claudeCodeSessionId, "new-session-uuid");
  assertEquals(unchanged, false);
  assertEquals(unchangedMeta.claudeCodeSessionId, undefined);
  assertEquals(unrelated, false);
  assertEquals(unrelatedMeta.claudeCodeSessionId, undefined);
  assertEquals(disabled, false);
  assertEquals(disabledMeta.claudeCodeSessionId, undefined);
});
