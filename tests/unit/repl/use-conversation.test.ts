import { assertEquals } from "jsr:@std/assert";
import {
  __testOnlyAppendDelegateItem,
  __testOnlyCompleteDelegateItem,
  __testOnlyUpsertAssistantTextItem,
} from "../../../src/hlvm/cli/repl-ink/hooks/useConversation.ts";
import type { ConversationItem } from "../../../src/hlvm/cli/repl-ink/types.ts";

Deno.test("useConversation inserts a final assistant response before trailing turn stats", () => {
  const items: ConversationItem[] = [
    {
      type: "user",
      id: "u1",
      text: "what's new?",
      ts: 1,
    },
    {
      type: "tool_group",
      id: "tg1",
      ts: 2,
      tools: [{
        id: "tool1",
        name: "search_web",
        argsSummary: "query=news",
        status: "success",
        resultSummaryText: "Top sources",
        resultText: "Top sources",
        toolIndex: 1,
        toolTotal: 1,
      }],
    },
    {
      type: "turn_stats",
      id: "stats1",
      toolCount: 1,
      durationMs: 1200,
    },
  ];

  const next = __testOnlyUpsertAssistantTextItem(
    items,
    "Here is the answer.",
    false,
    undefined,
    () => "a1",
  );

  assertEquals(next.map((item) => item.type), ["user", "tool_group", "assistant", "turn_stats"]);
  assertEquals(next[2]?.type, "assistant");
  if (next[2]?.type === "assistant") {
    assertEquals(next[2].text, "Here is the answer.");
  }
});

Deno.test("useConversation records and completes delegate items", () => {
  const items: ConversationItem[] = __testOnlyAppendDelegateItem(
    [],
    "web",
    "Inspect docs",
    () => "d1",
  );
  const next = __testOnlyCompleteDelegateItem(items, {
    type: "delegate_end",
    agent: "web",
    task: "Inspect docs",
    success: true,
    summary: "Found relevant docs",
    durationMs: 120,
  });

  assertEquals(next.length, 1);
  assertEquals(next[0]?.type, "delegate");
  if (next[0]?.type === "delegate") {
    assertEquals(next[0].status, "success");
    assertEquals(next[0].summary, "Found relevant docs");
    assertEquals(next[0].agent, "web");
  }
});

Deno.test("useConversation updates the existing pending assistant item instead of appending a second one", () => {
  const items: ConversationItem[] = [
    {
      type: "user",
      id: "u1",
      text: "hello",
      ts: 1,
    },
    {
      type: "assistant",
      id: "a1",
      text: "Hel",
      isPending: true,
      ts: 2,
    },
  ];

  const next = __testOnlyUpsertAssistantTextItem(
    items,
    "Hello there",
    false,
    undefined,
    () => "a2",
  );

  assertEquals(next.length, 2);
  assertEquals(next[1]?.type, "assistant");
  if (next[1]?.type === "assistant") {
    assertEquals(next[1].text, "Hello there");
    assertEquals(next[1].isPending, false);
    assertEquals(next[1].id, "a1");
  }
});
