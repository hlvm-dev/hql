import { assertEquals } from "jsr:@std/assert";
import {
  getActiveThinkingId,
  getConversationDisplayItems,
  getPlanFlowActivitySummary,
  getRecentPlanFlowActivitySummaries,
  shouldHideConversationTextInCompactPlanFlow,
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

Deno.test("getConversationDisplayItems compacts plan-mode transcript noise by hiding thinking and turn stats but keeping tool groups visible", () => {
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
      status: "completed",
    },
    {
      type: "assistant",
      id: "assistant-1",
      text: "Plan ready.",
      isPending: false,
      ts: 2,
    },
  ], { compactPlanTranscript: true });

  assertEquals(compactItems.map((item) => item.type), [
    "tool_group",
    "assistant",
  ]);
});

Deno.test("getConversationDisplayItems preserves previous conversation history during compact plan mode", () => {
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
    compactItems.map((item) =>
      `${item.type}:${"text" in item ? item.text : item.id}`
    ),
    [
      "user:old request",
      "assistant:Old answer",
      "user:new request",
      "assistant:Current answer",
    ],
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

Deno.test("getConversationDisplayItems hides the current-turn prompt and assistant text while a picker interaction is active but preserves prior history", () => {
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

  // Previous history is preserved; only current-turn user/assistant suppressed
  assertEquals(
    compactItems.map((item) =>
      `${item.type}:${"text" in item ? item.text : item.id}`
    ),
    ["user:old prompt", "assistant:Older answer"],
  );
});

Deno.test("getConversationDisplayItems keeps the current-turn prompt visible for non-plan picker flows", () => {
  const displayItems = getConversationDisplayItems([
    {
      type: "user",
      id: "user-1",
      text: "remove firefox app",
      ts: 1,
    },
    {
      type: "assistant",
      id: "assistant-1",
      text: "Would you like me to open Terminal for you?",
      isPending: false,
      ts: 2,
    },
  ], {
    compactPlanTranscript: false,
    suppressCurrentTurnPrompt: true,
  });

  assertEquals(
    displayItems.map((item) =>
      `${item.type}:${"text" in item ? item.text : item.id}`
    ),
    [
      "user:remove firefox app",
      "assistant:Would you like me to open Terminal for you?",
    ],
  );
});

Deno.test("getConversationDisplayItems hides user and assistant transcript text during active compact plan flow but keeps tool groups", () => {
  const compactItems = getConversationDisplayItems([
    {
      type: "user",
      id: "user-1",
      text: "make plan",
      ts: 1,
    },
    {
      type: "assistant",
      id: "assistant-1",
      text:
        "Direct prose that should not appear in the compact planning surface.",
      isPending: false,
      ts: 2,
    },
    {
      type: "tool_group",
      id: "tool-group-success",
      ts: 2.5,
      tools: [{
        id: "tool-success",
        name: "list_files",
        argsSummary: "~/Desktop",
        status: "success",
        resultSummaryText: "Listed 5 files",
        resultText: "Listed 5 files",
        toolIndex: 1,
        toolTotal: 1,
      }],
    },
    {
      type: "tool_group",
      id: "tool-group-1",
      ts: 3,
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
  ], {
    compactPlanTranscript: true,
    hideConversationText: true,
  });

  // Both successful AND errored tool groups are visible (progress visibility)
  assertEquals(compactItems.map((item) => item.type), [
    "tool_group",
    "tool_group",
  ]);
});

Deno.test("shouldHideConversationTextInCompactPlanFlow keeps final assistant text visible once execution is idle", () => {
  assertEquals(
    shouldHideConversationTextInCompactPlanFlow(
      true,
      "executing",
      StreamingState.Idle,
      false,
    ),
    false,
  );
  assertEquals(
    shouldHideConversationTextInCompactPlanFlow(
      true,
      "executing",
      StreamingState.Responding,
      false,
    ),
    true,
  );
  assertEquals(
    shouldHideConversationTextInCompactPlanFlow(
      true,
      "executing",
      StreamingState.Idle,
      true,
    ),
    true,
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
        argsSummary:
          "path=src/hlvm/cli/repl-ink/components/ConversationPanel.tsx",
        status: "running",
        toolIndex: 1,
        toolTotal: 1,
      }],
    },
  ]);

  assertEquals(
    summary,
    "Reading ConversationPanel.tsx",
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

Deno.test("getConversationDisplayItems preserves prompt during non-picker interactions in plan flow", () => {
  // Non-picker interactions (e.g., question mode without options) should NOT
  // suppress the current-turn prompt — only picker-style interactions should.
  const displayItems = getConversationDisplayItems([
    {
      type: "user",
      id: "user-1",
      text: "implement the feature",
      ts: 1,
    },
    {
      type: "assistant",
      id: "assistant-1",
      text: "I have a question about the approach.",
      isPending: false,
      ts: 2,
    },
  ], {
    compactPlanTranscript: true,
    // suppressCurrentTurnPrompt should be false for non-picker interactions
    suppressCurrentTurnPrompt: false,
  });

  assertEquals(
    displayItems.map((item) =>
      `${item.type}:${"text" in item ? item.text : item.id}`
    ),
    [
      "user:implement the feature",
      "assistant:I have a question about the approach.",
    ],
  );
});

Deno.test("getRecentPlanFlowActivitySummaries returns the latest distinct tool activity trail", () => {
  const summaries = getRecentPlanFlowActivitySummaries([
    {
      type: "tool_group",
      id: "tool-group-1",
      ts: 1,
      tools: [{
        id: "tool-1",
        name: "list_files",
        argsSummary: "~/Desktop",
        status: "success",
        toolIndex: 1,
        toolTotal: 2,
      }, {
        id: "tool-2",
        name: "read_file",
        argsSummary: "src/app.tsx",
        status: "success",
        toolIndex: 2,
        toolTotal: 2,
      }],
    },
    {
      type: "tool_group",
      id: "tool-group-2",
      ts: 2,
      tools: [{
        id: "tool-3",
        name: "shell_exec",
        argsSummary: "mv ~/Desktop/a ~/Desktop/screenshots/",
        status: "running",
        toolIndex: 1,
        toolTotal: 1,
      }],
    },
  ]);

  assertEquals(summaries, [
    "Moving files: mv ~/Desktop/a ~/Desktop/screenshots/",
    "Reading app.tsx",
    "Listing Desktop",
  ]);
});
