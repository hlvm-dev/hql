/**
 * Session Store Tests
 *
 * Verifies session persistence when context trimming drops older messages.
 */

import { assertEquals } from "jsr:@std/assert";
import {
  appendSessionMessages,
  createSession,
  loadSessionMessages,
} from "../../../src/hlvm/agent/session-store.ts";
import type { Message } from "../../../src/hlvm/agent/context.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

Deno.test({
  name: "Session Store: appendSessionMessages persists new messages after trimming",
  async fn() {
    const platform = getPlatform();
    const tempDir = await platform.fs.makeTempDir({
      prefix: "hlvm-session-store-",
    });
    const sessionsDir = platform.path.join(tempDir, "sessions");
    await platform.fs.mkdir(sessionsDir, { recursive: true });
    const scope = { sessionsDir };

    try {
      const entry = await createSession("test-session", scope);
      const initialMessages: Message[] = [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "old question" },
        { role: "assistant", content: "old answer" },
      ];

      let updated = await appendSessionMessages(entry, initialMessages, scope);
      let loaded = await loadSessionMessages(updated, scope);
      assertEquals(loaded.length, 4);

      const trimmedContext: Message[] = [
        { ...loaded[2], fromSession: true },
        { ...loaded[3], fromSession: true },
        { role: "user", content: "new question" },
        { role: "assistant", content: "new answer" },
      ];

      updated = await appendSessionMessages(updated, trimmedContext, scope);
      loaded = await loadSessionMessages(updated, scope);

      assertEquals(loaded.length, 6);
      assertEquals(loaded[4].content, "new question");
      assertEquals(loaded[5].content, "new answer");
    } finally {
      await platform.fs.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "Session Store: loadSessionMessages preserves empty assistant tool-call messages",
  async fn() {
    const platform = getPlatform();
    const tempDir = await platform.fs.makeTempDir({
      prefix: "hlvm-session-store-toolcalls-",
    });
    const sessionsDir = platform.path.join(tempDir, "sessions");
    await platform.fs.mkdir(sessionsDir, { recursive: true });
    const scope = { sessionsDir };

    try {
      const entry = await createSession("tool-call-session", scope);
      const transcript: Message[] = [
        {
          role: "assistant",
          content: "",
          toolCalls: [{
            id: "call_read_1",
            function: { name: "read_file", arguments: { path: "README.md" } },
          }],
        },
        {
          role: "tool",
          content: "file body",
          toolName: "read_file",
          toolCallId: "call_read_1",
        },
      ];

      const updated = await appendSessionMessages(entry, transcript, scope);
      const loaded = await loadSessionMessages(updated, scope);

      assertEquals(loaded.length, 2);
      assertEquals(loaded[0].role, "assistant");
      assertEquals(loaded[0].toolCalls?.[0]?.id, "call_read_1");
      assertEquals(loaded[1].role, "tool");
      assertEquals(loaded[1].toolCallId, "call_read_1");
    } finally {
      await platform.fs.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "Session Store: loadSessionMessages extends transcript tail to include leading tool-call boundary",
  async fn() {
    const platform = getPlatform();
    const tempDir = await platform.fs.makeTempDir({
      prefix: "hlvm-session-store-tail-boundary-",
    });
    const sessionsDir = platform.path.join(tempDir, "sessions");
    await platform.fs.mkdir(sessionsDir, { recursive: true });
    const scope = { sessionsDir };

    try {
      const entry = await createSession("tail-boundary-session", scope);
      const transcript: Message[] = [
        {
          role: "assistant",
          content: "",
          toolCalls: [{
            id: "call_read_1",
            function: { name: "read_file", arguments: { path: "README.md" } },
          }],
        },
        {
          role: "tool",
          content: "file body",
          toolName: "read_file",
          toolCallId: "call_read_1",
        },
        ...Array.from({ length: 499 }, (_, index): Message => ({
          role: "user",
          content: `filler-${index}`,
        })),
      ];

      const updated = await appendSessionMessages(entry, transcript, scope);
      const loaded = await loadSessionMessages(updated, scope);

      assertEquals(loaded.length, 501);
      assertEquals(loaded[0].role, "assistant");
      assertEquals(loaded[0].toolCalls?.[0]?.id, "call_read_1");
      assertEquals(loaded[1].role, "tool");
      assertEquals(loaded[1].toolCallId, "call_read_1");
    } finally {
      await platform.fs.remove(tempDir, { recursive: true });
    }
  },
});
