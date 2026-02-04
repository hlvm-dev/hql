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
import { resetHlvmDirCache } from "../../../src/common/paths.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

Deno.test({
  name: "Session Store: appendSessionMessages persists new messages after trimming",
  async fn() {
    const platform = getPlatform();
    const tempDir = await platform.fs.makeTempDir({
      prefix: "hlvm-session-store-",
    });
    const previousHlvmDir = Deno.env.get("HLVM_DIR");
    Deno.env.set("HLVM_DIR", tempDir);
    resetHlvmDirCache();

    try {
      const entry = await createSession("test-session");
      const initialMessages: Message[] = [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "old question" },
        { role: "assistant", content: "old answer" },
      ];

      let updated = await appendSessionMessages(entry, initialMessages);
      let loaded = await loadSessionMessages(updated);
      assertEquals(loaded.length, 4);

      const trimmedContext: Message[] = [
        { ...loaded[2], fromSession: true },
        { ...loaded[3], fromSession: true },
        { role: "user", content: "new question" },
        { role: "assistant", content: "new answer" },
      ];

      updated = await appendSessionMessages(updated, trimmedContext);
      loaded = await loadSessionMessages(updated);

      assertEquals(loaded.length, 6);
      assertEquals(loaded[4].content, "new question");
      assertEquals(loaded[5].content, "new answer");
    } finally {
      if (previousHlvmDir === undefined) {
        Deno.env.delete("HLVM_DIR");
      } else {
        Deno.env.set("HLVM_DIR", previousHlvmDir);
      }
      resetHlvmDirCache();
      await platform.fs.remove(tempDir, { recursive: true });
    }
  },
});
