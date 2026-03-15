import { assertEquals } from "jsr:@std/assert";
import {
  getActiveThinkingId,
  getConversationDisplayItems,
  getPlanFlowActivitySummary,
} from "../../../src/hlvm/cli/repl-ink/components/ConversationPanel.tsx";
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

Deno.test("getConversationDisplayItems compacts plan-mode transcript noise by hiding thinking, turn stats, and successful tool groups", () => {
  const compactItems = getConversationDisplayItems([
    {
      type: "thinking",
      id: "thinking-1",
      kind: "planning",
      summary: "Inspect the named file first.",
      iteration: 1,
    },
    {
      type: "tool_group",
      id: "tool-group-1",
      ts: 1,
      tools: [{
        id: "tool-1",
        name: "read_file",
        argsSummary: "path=src/app.tsx",
        status: "success",
        resultSummaryText: "Read 120 lines",
        resultText: "Read 120 lines",
        toolIndex: 1,
        toolTotal: 1,
      }],
    },
    {
      type: "turn_stats",
      id: "stats-1",
      toolCount: 1,
      durationMs: 120,
    },
    {
      type: "assistant",
      id: "assistant-1",
      text: "Plan ready.",
      isPending: false,
      ts: 2,
    },
  ], { compactPlanTranscript: true });

  assertEquals(compactItems.map((item) => item.type), ["assistant"]);
});

Deno.test("getConversationDisplayItems shows only the current turn while compact plan mode is active", () => {
  const compactItems = getConversationDisplayItems([
    {
      type: "user",
      id: "user-1",
      text: "old request",
      ts: 1,
    },
    {
      type: "assistant",
      id: "assistant-1",
      text: "Old answer",
      isPending: false,
      ts: 2,
    },
    {
      type: "user",
      id: "user-2",
      text: "new request",
      ts: 3,
    },
    {
      type: "assistant",
      id: "assistant-2",
      text: "Current answer",
      isPending: false,
      ts: 4,
    },
  ], { compactPlanTranscript: true });

  assertEquals(
    compactItems.map((item) => `${item.type}:${"text" in item ? item.text : item.id}`),
    ["user:new request", "assistant:Current answer"],
  );
});

Deno.test("getConversationDisplayItems keeps errored tool groups visible during compact plan mode", () => {
  const compactItems = getConversationDisplayItems([
    {
      type: "tool_group",
      id: "tool-group-1",
      ts: 1,
      tools: [{
        id: "tool-1",
        name: "read_file",
        argsSummary: "path=src/app.tsx",
        status: "error",
        resultSummaryText: "File not found",
        resultText: "File not found",
        toolIndex: 1,
        toolTotal: 1,
      }],
    },
  ], { compactPlanTranscript: true });

  assertEquals(compactItems.map((item) => item.type), ["tool_group"]);
});

Deno.test("getConversationDisplayItems hides the current-turn prompt and assistant text while a picker interaction is active", () => {
  const compactItems = getConversationDisplayItems([
    {
      type: "user",
      id: "user-1",
      text: "old prompt",
      ts: 1,
    },
    {
      type: "assistant",
      id: "assistant-1",
      text: "Older answer",
      isPending: false,
      ts: 2,
    },
    {
      type: "user",
      id: "user-2",
      text: "make plan",
      ts: 3,
    },
    {
      type: "assistant",
      id: "assistant-2",
      text: "Plan ready.",
      isPending: false,
      ts: 4,
    },
  ], {
    compactPlanTranscript: true,
    suppressCurrentTurnPrompt: true,
  });

  assertEquals(
    compactItems.map((item) => `${item.type}:${"text" in item ? item.text : item.id}`),
    [],
  );
});

Deno.test("getPlanFlowActivitySummary prefers the latest tool activity for compact plan headers", () => {
  const summary = getPlanFlowActivitySummary([
    {
      type: "thinking",
      id: "thinking-1",
      kind: "planning",
      summary: "Draft the smallest safe plan.",
      iteration: 1,
    },
    {
      type: "tool_group",
      id: "tool-group-1",
      ts: 1,
      tools: [{
        id: "tool-1",
        name: "read_file",
        argsSummary: "path=src/hlvm/cli/repl-ink/components/ConversationPanel.tsx",
        status: "running",
        toolIndex: 1,
        toolTotal: 1,
      }],
    },
  ]);

  assertEquals(
    summary,
    "Reading path=src/hlvm/cli/repl-ink/components/ConversationPanel.tsx",
  );
});

Deno.test("getPlanFlowActivitySummary humanizes shell_exec filesystem activity", () => {
  const summary = getPlanFlowActivitySummary([
    {
      type: "tool_group",
      id: "tool-group-1",
      ts: 1,
      tools: [{
        id: "tool-1",
        name: "shell_exec",
        argsSummary: "mkdir -p ~/Desktop/screenshots",
        status: "running",
        toolIndex: 1,
        toolTotal: 1,
      }],
    },
  ]);

  assertEquals(
    summary,
    "Creating directories: mkdir -p ~/Desktop/screenshots",
  );
});
