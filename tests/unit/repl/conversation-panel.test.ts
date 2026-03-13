import { assertEquals } from "jsr:@std/assert";
import { getActiveThinkingId } from "../../../src/hlvm/cli/repl-ink/components/ConversationPanel.tsx";
import { StreamingState } from "../../../src/hlvm/cli/repl-ink/types.ts";
import type { ConversationItem } from "../../../src/hlvm/cli/repl-ink/types.ts";

const items: ConversationItem[] = [
  {
    type: "thinking",
    id: "reasoning-1",
    kind: "reasoning",
    summary: "Inspect the file first.",
    iteration: 1,
  },
  {
    type: "assistant",
    id: "assistant-1",
    text: "Let me check that.",
    isPending: true,
    ts: 1,
  },
  {
    type: "thinking",
    id: "planning-2",
    kind: "planning",
    summary: "Patch the smallest safe diff.",
    iteration: 2,
  },
];

Deno.test("getActiveThinkingId animates only the latest thinking row while responding", () => {
  assertEquals(
    getActiveThinkingId(items, StreamingState.Responding),
    "planning-2",
  );
});

Deno.test("getActiveThinkingId disables animation when the stream is idle", () => {
  assertEquals(getActiveThinkingId(items, StreamingState.Idle), undefined);
});

Deno.test("getActiveThinkingId does not re-animate prior-turn thinking before the current turn emits reasoning or planning", () => {
  const nextTurnItems: ConversationItem[] = [
    {
      type: "user",
      id: "user-1",
      text: "first",
      ts: 1,
    },
    {
      type: "thinking",
      id: "reasoning-old",
      kind: "reasoning",
      summary: "Previous turn reasoning.",
      iteration: 1,
    },
    {
      type: "assistant",
      id: "assistant-1",
      text: "First answer",
      isPending: false,
      ts: 2,
    },
    {
      type: "user",
      id: "user-2",
      text: "second",
      ts: 3,
    },
    {
      type: "assistant",
      id: "assistant-2",
      text: "",
      isPending: true,
      ts: 4,
    },
  ];

  assertEquals(
    getActiveThinkingId(nextTurnItems, StreamingState.Responding),
    undefined,
  );
});
