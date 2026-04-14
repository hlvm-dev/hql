import { assertEquals } from "jsr:@std/assert@1";
import {
  compactPlanTranscriptItems,
  derivePlanSurfaceState,
  getPlanCurrentStep,
  getPlanFlowActivitySummary,
  getPlanPhaseLabel,
  getPlanPhasePlaceholder,
  getPlanProgressLabel,
  getPlanSurfaceItems,
  getRecentPlanFlowActivitySummaries,
  summarizePlanTodoState,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/plan-flow.ts";
import type { AgentConversationItem } from "../../../src/hlvm/cli/repl-ink/types.ts";

Deno.test("summarizePlanTodoState returns stable plan progress counts", () => {
  const summary = summarizePlanTodoState({
    items: [
      { id: "step-1", content: "Inspect files", status: "completed" },
      { id: "step-2", content: "Draft plan", status: "in_progress" },
      { id: "step-3", content: "Review output", status: "pending" },
    ],
  });

  assertEquals(summary, {
    completed: 1,
    inProgress: 1,
    pending: 1,
    total: 3,
  });
  assertEquals(
    getPlanProgressLabel({
      items: [
        { id: "step-1", content: "Inspect files", status: "completed" },
        { id: "step-2", content: "Draft plan", status: "in_progress" },
        { id: "step-3", content: "Review output", status: "pending" },
      ],
    }),
    "1/3 completed",
  );
  assertEquals(
    getPlanCurrentStep({
      items: [
        { id: "step-1", content: "Inspect files", status: "completed" },
        { id: "step-2", content: "Draft plan", status: "in_progress" },
        { id: "step-3", content: "Review output", status: "pending" },
      ],
    }),
    "Draft plan",
  );
});

Deno.test("getPlanPhaseLabel uses review-specific wording", () => {
  assertEquals(getPlanPhaseLabel("researching"), "Plan research");
  assertEquals(getPlanPhaseLabel("reviewing"), "Plan review");
  assertEquals(getPlanPhaseLabel("executing"), "Plan executing");
  assertEquals(getPlanPhaseLabel(undefined), "Plan mode");
  assertEquals(
    getPlanPhasePlaceholder("researching"),
    "Gathering the first planning step",
  );
});

Deno.test("getPlanSurfaceItems hides checklist and approval-only tool rows", () => {
  const items: AgentConversationItem[] = [
    {
      type: "thinking",
      id: "thinking-1",
      kind: "planning",
      summary: "Draft the plan.",
      iteration: 1,
    },
    {
      type: "tool_group",
      id: "tool-group-1",
      ts: 1,
      tools: [{
        id: "tool-1",
        name: "todo_write",
        argsSummary: "3 todos",
        status: "success",
        resultSummaryText: "Updated todo list",
        resultText: "Updated todo list",
        toolIndex: 1,
        toolTotal: 1,
      }],
    },
    {
      type: "tool_group",
      id: "tool-group-2",
      ts: 2,
      tools: [{
        id: "tool-2",
        name: "todo_write",
        argsSummary: "4 todos",
        status: "success",
        resultSummaryText: "Updated todo list",
        resultText: "Updated todo list",
        toolIndex: 1,
        toolTotal: 2,
      }, {
        id: "tool-3",
        name: "read_file",
        argsSummary: "src/app.tsx",
        status: "success",
        resultSummaryText: "Read 42 lines",
        resultText: "Read 42 lines",
        toolIndex: 2,
        toolTotal: 2,
      }],
    },
  ];

  const surfaceItems = getPlanSurfaceItems(items);

  assertEquals(surfaceItems.length, 1);
  assertEquals(surfaceItems[0]?.type, "tool_group");
  if (surfaceItems[0]?.type === "tool_group") {
    assertEquals(surfaceItems[0].tools.map((tool) => tool.name), ["read_file"]);
  }
});

Deno.test("compactPlanTranscriptItems preserves prior history while hiding current plan orchestration noise", () => {
  const items: AgentConversationItem[] = [
    {
      type: "user",
      id: "user-1",
      text: "hello",
      ts: 1,
    },
    {
      type: "assistant",
      id: "assistant-1",
      text: "Hi there.",
      isPending: false,
      ts: 2,
    },
    {
      type: "user",
      id: "user-2",
      text: "make a plan",
      ts: 3,
    },
    {
      type: "thinking",
      id: "thinking-2",
      kind: "planning",
      summary: "Write the plan first.",
      iteration: 2,
    },
    {
      type: "tool_group",
      id: "tool-group-2",
      ts: 4,
      tools: [{
        id: "tool-2",
        name: "todo_write",
        argsSummary: "4 todos",
        status: "success",
        resultSummaryText: "Updated todo list",
        resultText: "Updated todo list",
        toolIndex: 1,
        toolTotal: 1,
      }],
    },
    {
      type: "tool_group",
      id: "tool-group-3",
      ts: 5,
      tools: [{
        id: "tool-3",
        name: "read_file",
        argsSummary: "src/app.tsx",
        status: "success",
        resultSummaryText: "Read 42 lines",
        resultText: "Read 42 lines",
        toolIndex: 1,
        toolTotal: 1,
      }],
    },
  ];

  assertEquals(
    compactPlanTranscriptItems(items).map((item) => item.id),
    ["user-1", "assistant-1", "user-2", "tool-group-3"],
  );
});

Deno.test("compactPlanTranscriptItems leaves ordinary non-plan turns unchanged", () => {
  const items: AgentConversationItem[] = [
    {
      type: "user",
      id: "user-1",
      text: "hello",
      ts: 1,
    },
    {
      type: "assistant",
      id: "assistant-1",
      text: "Hi there.",
      isPending: false,
      ts: 2,
    },
    {
      type: "turn_stats",
      id: "stats-1",
      toolCount: 0,
      durationMs: 1200,
      status: "completed",
    },
  ];

  assertEquals(compactPlanTranscriptItems(items).map((item) => item.id), [
    "user-1",
    "assistant-1",
    "stats-1",
  ]);
});

Deno.test("derivePlanSurfaceState centralizes the active checklist, current step, and recent activities", () => {
  const state = derivePlanSurfaceState({
    planningPhase: "executing",
    todoState: {
      items: [
        { id: "step-1", content: "Inspect files", status: "completed" },
        {
          id: "step-2",
          content: "Implement plan shell",
          status: "in_progress",
        },
        { id: "step-3", content: "Run targeted tests", status: "pending" },
      ],
    },
    items: [
      {
        type: "tool_group",
        id: "tool-group-1",
        ts: 1,
        tools: [{
          id: "tool-2",
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
        id: "tool-group-2",
        ts: 2,
        tools: [{
          id: "tool-3",
          name: "read_file",
          argsSummary: "src/hlvm/cli/repl-ink/components/App.tsx",
          status: "success",
          resultSummaryText: "Read 42 lines",
          resultText: "Read 42 lines",
          toolIndex: 1,
          toolTotal: 1,
        }],
      },
    ],
  });

  assertEquals(state.active, true);
  assertEquals(state.phaseLabel, "Plan executing");
  assertEquals(state.progressLabel, "1/3 completed");
  assertEquals(state.currentStep, "Implement plan shell");
  assertEquals(
    state.currentActivity,
    "Reading App.tsx",
  );
  assertEquals(state.recentActivities, [
    "Reading App.tsx",
    "Listing Desktop",
  ]);
});

Deno.test("getPlanFlowActivitySummary skips checklist noise and surfaces the real current action", () => {
  const items: AgentConversationItem[] = [
    {
      type: "tool_group",
      id: "tool-group-1",
      ts: 1,
      tools: [{
        id: "tool-1",
        name: "read_file",
        argsSummary: "src/hlvm/cli/repl-ink/components/App.tsx",
        status: "success",
        resultSummaryText: "Read 10 lines",
        resultText: "Read 10 lines",
        toolIndex: 1,
        toolTotal: 1,
      }],
    },
    {
      type: "tool_group",
      id: "tool-group-2",
      ts: 2,
      tools: [{
        id: "tool-2",
        name: "todo_write",
        argsSummary: "5 todos",
        status: "success",
        resultSummaryText: "Updated todo list",
        resultText: "Updated todo list",
        toolIndex: 1,
        toolTotal: 1,
      }],
    },
    {
      type: "tool_group",
      id: "tool-group-3",
      ts: 3,
      tools: [{
        id: "tool-3",
        name: "ask_user",
        argsSummary: "confirm scope",
        status: "running",
        toolIndex: 1,
        toolTotal: 1,
      }],
    },
  ];

  assertEquals(
    getPlanFlowActivitySummary(items),
    "Reading App.tsx",
  );
});

Deno.test("getRecentPlanFlowActivitySummaries preserves error activity while hiding orchestration noise", () => {
  const items: AgentConversationItem[] = [
    {
      type: "tool_group",
      id: "tool-group-1",
      ts: 1,
      tools: [{
        id: "tool-1",
        name: "todo_write",
        argsSummary: "4 todos",
        status: "success",
        resultSummaryText: "Updated todo list",
        resultText: "Updated todo list",
        toolIndex: 1,
        toolTotal: 1,
      }],
    },
    {
      type: "error",
      id: "error-1",
      text: "Test run failed",
    },
  ];

  assertEquals(getRecentPlanFlowActivitySummaries(items), [
    "Test run failed",
  ]);
});
