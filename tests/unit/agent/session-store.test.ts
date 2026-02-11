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
