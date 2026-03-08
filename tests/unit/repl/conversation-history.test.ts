import { assertEquals } from "jsr:@std/assert";
import { buildConversationItemsFromSessionMessages } from "../../../src/hlvm/cli/repl-ink/conversation-history.ts";

Deno.test("buildConversationItemsFromSessionMessages maps persisted transcript rows into conversation items", () => {
  const items = buildConversationItemsFromSessionMessages([
    {
      role: "user",
      content: "hello",
      ts: 1,
    },
    {
      role: "assistant",
      content: "hi",
      ts: 2,
    },
  ]);

  assertEquals(items, [
    {
      type: "user",
      id: "session-user-0",
      text: "hello",
      ts: 1,
    },
    {
      type: "assistant",
      id: "session-assistant-1",
      text: "hi",
      isPending: false,
      ts: 2,
    },
  ]);
});
