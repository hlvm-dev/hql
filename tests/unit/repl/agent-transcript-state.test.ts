import { assertEquals } from "jsr:@std/assert";
import {
  createTranscriptState,
  reduceTranscriptState,
} from "../../../src/hlvm/cli/agent-transcript-state.ts";
import type { Plan } from "../../../src/hlvm/agent/planning.ts";
import {
  type ConversationItem,
  createConversationAttachmentRefs,
  isStructuredTeamInfoItem,
  StreamingState,
} from "../../../src/hlvm/cli/repl-ink/types.ts";

function withItems(items: ConversationItem[]) {
  return {
    ...createTranscriptState(),
    items,
    nextId: items.length,
  };
}

const samplePlan: Plan = {
  goal: "Organize the desktop",
  steps: [
    { id: "step-1", title: "Create the screenshots directory" },
    { id: "step-2", title: "Move screenshot files" },
  ],
};

Deno.test("agent transcript state drops stale turn stats when assistant text continues the same turn", () => {
  const state = withItems([
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
      status: "completed",
    },
  ]);

  const next = reduceTranscriptState(state, {
    type: "assistant_text",
    text: "Here is the answer.",
    isPending: false,
  });

  assertEquals(next.items.map((item) => item.type), [
    "user",
    "tool_group",
    "assistant",
  ]);
  assertEquals(next.items[2]?.type, "assistant");
  if (next.items[2]?.type === "assistant") {
    assertEquals(next.items[2].text, "Here is the answer.");
  }
});

Deno.test("agent transcript state updates delegate items through the delegate lifecycle", () => {
  const started = reduceTranscriptState(createTranscriptState(), {
    type: "agent_event",
    event: {
      type: "delegate_start",
      agent: "web",
      task: "Inspect docs",
      childSessionId: "child-1",
    },
  });

  const completed = reduceTranscriptState(started, {
    type: "agent_event",
    event: {
      type: "delegate_end",
      agent: "web",
      task: "Inspect docs",
      success: true,
      summary: "Found relevant docs",
      durationMs: 120,
      childSessionId: "child-1",
      snapshot: {
        agent: "web",
        task: "Inspect docs",
        success: true,
        durationMs: 120,
        toolCount: 1,
        finalResponse: "Done",
        events: [{
          type: "tool_end",
          name: "search_web",
          success: true,
          summary: "Found docs",
          durationMs: 15,
          argsSummary: "docs",
        }],
      },
    },
  });

  assertEquals(completed.items.length, 1);
  assertEquals(completed.items[0]?.type, "delegate");
  if (completed.items[0]?.type === "delegate") {
    assertEquals(completed.items[0].status, "success");
    assertEquals(completed.items[0].summary, "Found relevant docs");
    assertEquals(completed.items[0].childSessionId, "child-1");
    assertEquals(completed.items[0].snapshot?.toolCount, 1);
  }
});

Deno.test("agent transcript state streams into the existing pending assistant item", () => {
  const state = withItems([
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
  ]);

  const next = reduceTranscriptState(state, {
    type: "assistant_text",
    text: "Hello there",
    isPending: false,
  });

  assertEquals(next.items.length, 2);
  assertEquals(next.items[1]?.type, "assistant");
  if (next.items[1]?.type === "assistant") {
    assertEquals(next.items[1].id, "a1");
    assertEquals(next.items[1].text, "Hello there");
    assertEquals(next.items[1].isPending, false);
  }
});

Deno.test("agent transcript state preserves user attachment labels for the active turn", () => {
  const next = reduceTranscriptState(createTranscriptState(), {
    type: "user_message",
    text: "[Pasted text #1 +2 lines]",
    submittedText: "line 1\nline 2\nline 3",
    attachments: createConversationAttachmentRefs(["[Image #1]", "[PDF #2]"]),
  });

  assertEquals(next.items.length, 2);
  assertEquals(next.items[0]?.type, "user");
  if (next.items[0]?.type === "user") {
    assertEquals(next.items[0].text, "[Pasted text #1 +2 lines]");
    assertEquals(next.items[0].submittedText, "line 1\nline 2\nline 3");
    assertEquals(
      next.items[0].attachments,
      createConversationAttachmentRefs(["[Image #1]", "[PDF #2]"]),
    );
  }
  assertEquals(next.items[1]?.type, "assistant");
  if (next.items[1]?.type === "assistant") {
    assertEquals(next.items[1].isPending, true);
  }
});

Deno.test("agent transcript state keeps prior completed answers when a new turn starts", () => {
  const state = withItems([
    {
      type: "user",
      id: "u1",
      text: "first",
      ts: 1,
    },
    {
      type: "assistant",
      id: "a1",
      text: "First answer",
      isPending: false,
      ts: 2,
    },
    {
      type: "user",
      id: "u2",
      text: "second",
      ts: 3,
    },
  ]);

  const next = reduceTranscriptState(state, {
    type: "assistant_text",
    text: "Second answer",
    isPending: false,
  });

  assertEquals(next.items.length, 4);
  assertEquals(next.items[1]?.type, "assistant");
  if (next.items[1]?.type === "assistant") {
    assertEquals(next.items[1].id, "a1");
    assertEquals(next.items[1].text, "First answer");
  }
  assertEquals(next.items[3]?.type, "assistant");
  if (next.items[3]?.type === "assistant") {
    assertEquals(next.items[3].text, "Second answer");
  }
});

Deno.test("agent transcript state finalization removes transient rows and empty pending placeholders", () => {
  const state = withItems([
    {
      type: "user",
      id: "u1",
      text: "hello",
      ts: 1,
    },
    {
      type: "info",
      id: "i1",
      text: "Initializing agent...",
      isTransient: true,
    },
    {
      type: "assistant",
      id: "a1",
      text: "",
      isPending: true,
      ts: 2,
    },
    {
      type: "assistant",
      id: "a2",
      text: "partial answer",
      isPending: true,
      ts: 3,
    },
  ]);

  const next = reduceTranscriptState(state, {
    type: "finalize",
    status: "completed",
  });

  assertEquals(next.items.map((item) => item.type), ["user", "assistant"]);
  assertEquals(next.items[1]?.type, "assistant");
  if (next.items[1]?.type === "assistant") {
    assertEquals(next.items[1].text, "partial answer");
    assertEquals(next.items[1].isPending, false);
  }
});

Deno.test("agent transcript state clears the plan dashboard when review is cancelled", () => {
  const state = {
    ...createTranscriptState(),
    activePlan: samplePlan,
    planningPhase: "reviewing" as const,
    pendingPlanReview: { plan: samplePlan },
    completedPlanStepIds: ["step-1"],
    planTodoState: {
      items: [
        {
          id: "step-1",
          content: "Create the screenshots directory",
          status: "completed" as const,
        },
        {
          id: "step-2",
          content: "Move screenshot files",
          status: "pending" as const,
        },
      ],
    },
  };

  const next = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "plan_review_resolved",
      plan: samplePlan,
      approved: false,
      decision: "cancelled",
    },
  });

  assertEquals(next.activePlan, undefined);
  assertEquals(next.planningPhase, undefined);
  assertEquals(next.pendingPlanReview, undefined);
  assertEquals(next.completedPlanStepIds, []);
  assertEquals(next.planTodoState, undefined);
});

Deno.test("agent transcript state cancel_planning clears plan-owned todos too", () => {
  const state = {
    ...createTranscriptState(),
    activePlan: samplePlan,
    planningPhase: "executing" as const,
    todoState: {
      items: [
        {
          id: "step-1",
          content: "Create the screenshots directory",
          status: "in_progress" as const,
        },
      ],
    },
    planTodoState: {
      items: [
        {
          id: "step-1",
          content: "Create the screenshots directory",
          status: "in_progress" as const,
        },
      ],
    },
  };

  const next = reduceTranscriptState(state, { type: "cancel_planning" });

  assertEquals(next.activePlan, undefined);
  assertEquals(next.planningPhase, undefined);
  assertEquals(next.todoState, undefined);
  assertEquals(next.planTodoState, undefined);
});

Deno.test("agent transcript state finalize clears orphaned planning state when execution ends early", () => {
  const state = {
    ...createTranscriptState(),
    items: [
      {
        type: "assistant" as const,
        id: "assistant-1",
        text: "Partial execution output",
        isPending: false,
        ts: 1,
      },
    ],
    activePlan: samplePlan,
    planningPhase: "executing" as const,
    completedPlanStepIds: ["step-1"],
    todoState: {
      items: [{
        id: "step-1",
        content: "Create the screenshots directory",
        status: "in_progress" as const,
      }],
    },
    planTodoState: {
      items: [{
        id: "step-1",
        content: "Create the screenshots directory",
        status: "in_progress" as const,
      }],
    },
    pendingPlanReview: { plan: samplePlan },
  };

  const next = reduceTranscriptState(state, {
    type: "finalize",
    status: "completed",
  });

  assertEquals(next.items.length, 1);
  assertEquals(next.items[0]?.type, "assistant");
  assertEquals(next.activePlan, undefined);
  assertEquals(next.planningPhase, undefined);
  assertEquals(next.completedPlanStepIds, []);
  assertEquals(next.todoState, undefined);
  assertEquals(next.planTodoState, undefined);
  assertEquals(next.pendingPlanReview, undefined);
});

Deno.test("agent transcript state cancel_planning drops current-turn planning artifacts", () => {
  const state = {
    ...createTranscriptState(),
    items: [
      {
        type: "user" as const,
        id: "u1",
        text: "make a plan",
        ts: 1,
      },
      {
        type: "tool_group" as const,
        id: "tg1",
        ts: 2,
        tools: [{
          id: "tool-1",
          name: "list_files",
          argsSummary: "~/Desktop",
          status: "success" as const,
          toolIndex: 1,
          toolTotal: 1,
          resultSummaryText: "found files",
        }],
      },
      {
        type: "assistant" as const,
        id: "a1",
        text: "Pending plan response",
        isPending: true,
        ts: 3,
      },
    ],
    activePlan: samplePlan,
    planningPhase: "researching" as const,
    todoState: {
      items: [
        {
          id: "step-1",
          content: "Inspect Desktop",
          status: "in_progress" as const,
        },
      ],
    },
    planTodoState: {
      items: [
        {
          id: "step-1",
          content: "Inspect Desktop",
          status: "in_progress" as const,
        },
      ],
    },
  };

  const next = reduceTranscriptState(state, { type: "cancel_planning" });

  assertEquals(next.items.map((item) => item.type), ["user"]);
  assertEquals(next.activePlan, undefined);
  assertEquals(next.planningPhase, undefined);
  assertEquals(next.todoState, undefined);
  assertEquals(next.planTodoState, undefined);
});

Deno.test("agent transcript state returns to researching when review requests revision", () => {
  const state = {
    ...createTranscriptState(),
    activePlan: samplePlan,
    planningPhase: "reviewing" as const,
    pendingPlanReview: { plan: samplePlan },
  };

  const next = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "plan_review_resolved",
      plan: samplePlan,
      approved: false,
      decision: "revise",
    },
  });

  assertEquals(next.activePlan, samplePlan);
  assertEquals(next.planningPhase, "researching");
  assertEquals(next.pendingPlanReview, undefined);
});

Deno.test("agent transcript state clears finished plan state when a new turn starts", () => {
  const state = {
    ...createTranscriptState(),
    activePlan: samplePlan,
    planningPhase: "done" as const,
    completedPlanStepIds: ["step-1", "step-2"],
    planTodoState: {
      items: [
        {
          id: "step-1",
          content: "Create the screenshots directory",
          status: "completed" as const,
        },
        {
          id: "step-2",
          content: "Move screenshot files",
          status: "completed" as const,
        },
      ],
    },
  };

  const next = reduceTranscriptState(state, {
    type: "user_message",
    text: "hi man",
  });

  assertEquals(next.activePlan, undefined);
  assertEquals(next.planningPhase, undefined);
  assertEquals(next.completedPlanStepIds, []);
  assertEquals(next.planTodoState, undefined);
  assertEquals(next.items.at(-1)?.type, "assistant");
});

Deno.test("agent transcript state keeps provider reasoning summaries only while the turn is active", () => {
  let state = reduceTranscriptState(createTranscriptState(), {
    type: "agent_event",
    event: { type: "thinking", iteration: 1 },
  });

  assertEquals(state.items.length, 0);
  assertEquals(state.streamingState, "responding");

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "reasoning_update",
      iteration: 1,
      summary: "Inspect parser.ts before editing.",
    },
  });

  assertEquals(state.items.length, 1);
  assertEquals(state.items[0]?.type, "thinking");
  if (state.items[0]?.type === "thinking") {
    assertEquals(state.items[0].kind, "reasoning");
    assertEquals(state.items[0].summary, "Inspect parser.ts before editing.");
  }

  const finalized = reduceTranscriptState(state, {
    type: "finalize",
    status: "completed",
  });
  assertEquals(finalized.items.length, 0);
});

Deno.test("agent transcript state commits turn completion only when the turn finalizes", () => {
  let state = reduceTranscriptState(createTranscriptState(), {
    type: "user_message",
    text: "hello",
  });

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "reasoning_update",
      iteration: 1,
      summary: "Check the active file first.",
    },
  });

  state = reduceTranscriptState(state, {
    type: "assistant_text",
    text: "Hello there",
    isPending: false,
  });

  const next = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "turn_stats",
      iteration: 1,
      toolCount: 0,
      durationMs: 120,
      inputTokens: 10,
      outputTokens: 12,
      modelId: "claude-test",
    },
  });

  assertEquals(next.items.map((item) => item.type), [
    "user",
    "thinking",
    "assistant",
  ]);

  const finalized = reduceTranscriptState(next, {
    type: "finalize",
    status: "completed",
  });
  assertEquals(finalized.items.map((item) => item.type), [
    "user",
    "assistant",
    "turn_stats",
  ]);
});

Deno.test("agent transcript state records planning updates as reasoning outside explicit plan flow", () => {
  const next = reduceTranscriptState(createTranscriptState(), {
    type: "agent_event",
    event: {
      type: "planning_update",
      iteration: 2,
      summary: "Read config.ts and then update the import path.",
    },
  });

  assertEquals(next.items.length, 1);
  assertEquals(next.items[0]?.type, "thinking");
  if (next.items[0]?.type === "thinking") {
    assertEquals(next.items[0].kind, "reasoning");
    assertEquals(
      next.items[0].summary,
      "Read config.ts and then update the import path.",
    );
  }
});

Deno.test("agent transcript state preserves reasoning and planning for the same iteration", () => {
  let state = reduceTranscriptState(createTranscriptState(), {
    type: "agent_event",
    event: {
      type: "reasoning_update",
      iteration: 3,
      summary: "Inspect parser.ts before editing.",
    },
  });

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "planning_update",
      iteration: 3,
      summary: "Patch only the import path.",
    },
  });

  assertEquals(
    state.items.filter((item) => item.type === "thinking").map((item) =>
      item.type === "thinking" ? `${item.kind}:${item.summary}` : ""
    ),
    [
      "reasoning:Patch only the import path.",
    ],
  );
});

Deno.test("agent transcript state keeps only the latest reasoning and planning row per turn", () => {
  let state = reduceTranscriptState(createTranscriptState(), {
    type: "user_message",
    text: "plan this change",
  });

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "reasoning_update",
      iteration: 1,
      summary: "Inspect the file.",
    },
  });
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "reasoning_update",
      iteration: 2,
      summary: "Found the target block.",
    },
  });
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "planning_update",
      iteration: 2,
      summary: "Draft the plan from the gathered context.",
    },
  });
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "planning_update",
      iteration: 3,
      summary: "Ready to show the review card.",
    },
  });

  assertEquals(
    state.items.filter((item) => item.type === "thinking").map((item) =>
      item.type === "thinking"
        ? `${item.kind}:${item.iteration}:${item.summary}`
        : ""
    ),
    [
      "reasoning:3:Ready to show the review card.",
    ],
  );
});

Deno.test("agent transcript state clears prior-turn reasoning when later turns reuse iteration numbers", () => {
  let state = reduceTranscriptState(createTranscriptState(), {
    type: "user_message",
    text: "first turn",
  });

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "reasoning_update",
      iteration: 1,
      summary: "First-turn reasoning",
    },
  });

  state = reduceTranscriptState(state, {
    type: "finalize",
    status: "completed",
  });
  state = reduceTranscriptState(state, {
    type: "user_message",
    text: "second turn",
  });
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "reasoning_update",
      iteration: 1,
      summary: "Second-turn reasoning",
    },
  });

  assertEquals(
    state.items.filter((item) => item.type === "thinking").map((item) =>
      item.type === "thinking" ? item.summary : ""
    ),
    [
      "Second-turn reasoning",
    ],
  );
});

Deno.test("agent transcript state collapses repeated assistant blocks within one user turn", () => {
  const state = withItems([
    {
      type: "user",
      id: "u1",
      text: "hello",
      ts: 1,
    },
    {
      type: "tool_group",
      id: "tg1",
      ts: 2,
      tools: [{
        id: "tool1",
        name: "list_agents",
        argsSummary: "{}",
        status: "success",
        resultSummaryText: "{}",
        resultText: "{}",
        toolIndex: 1,
        toolTotal: 1,
      }],
    },
    {
      type: "assistant",
      id: "a1",
      text: "Hello there",
      isPending: false,
      ts: 3,
    },
    {
      type: "turn_stats",
      id: "stats1",
      toolCount: 1,
      durationMs: 1000,
      status: "completed",
    },
    {
      type: "tool_group",
      id: "tg2",
      ts: 4,
      tools: [{
        id: "tool2",
        name: "read_file",
        argsSummary: "/tmp/test.txt",
        status: "success",
        resultSummaryText: "contents",
        resultText: "contents",
        toolIndex: 1,
        toolTotal: 1,
      }],
    },
    {
      type: "assistant",
      id: "a2",
      text: "Hello there again",
      isPending: false,
      ts: 5,
    },
    {
      type: "turn_stats",
      id: "stats2",
      toolCount: 2,
      durationMs: 2000,
      status: "completed",
    },
  ]);

  const next = reduceTranscriptState(state, {
    type: "assistant_text",
    text: "Final answer",
    isPending: false,
  });

  assertEquals(next.items.map((item) => item.type), [
    "user",
    "tool_group",
    "tool_group",
    "assistant",
  ]);
  assertEquals(next.items[3]?.type, "assistant");
  if (next.items[3]?.type === "assistant") {
    assertEquals(next.items[3].text, "Final answer");
    assertEquals(next.items[3].id, "a2");
  }
});

Deno.test("agent transcript state keeps only the latest pending turn stats for the active user turn", () => {
  const withUser = reduceTranscriptState(createTranscriptState(), {
    type: "user_message",
    text: "hello",
  });

  const firstStats = reduceTranscriptState(withUser, {
    type: "agent_event",
    event: {
      type: "turn_stats",
      iteration: 1,
      toolCount: 1,
      durationMs: 1000,
    },
  });

  const secondStats = reduceTranscriptState(firstStats, {
    type: "agent_event",
    event: {
      type: "turn_stats",
      iteration: 2,
      toolCount: 2,
      durationMs: 2000,
    },
  });

  assertEquals(
    secondStats.items.filter((item) => item.type === "turn_stats").length,
    0,
  );
  assertEquals(secondStats.pendingTurnStats?.toolCount, 2);
  assertEquals(secondStats.pendingTurnStats?.durationMs, 2000);
});

Deno.test("agent transcript state clears prior plan and todo state when hydrating a resumed transcript", () => {
  const withPlan = reduceTranscriptState(createTranscriptState(), {
    type: "agent_event",
    event: {
      type: "plan_created",
      plan: {
        goal: "Inspect and fix",
        steps: [{
          id: "step-1",
          title: "Inspect files",
          goal: "Read the relevant files",
        }],
      },
    },
  });

  const withTodo = reduceTranscriptState(withPlan, {
    type: "agent_event",
    event: {
      type: "todo_updated",
      todoState: {
        items: [{
          id: "todo-1",
          content: "Inspect files",
          status: "in_progress",
        }],
      },
      source: "tool",
    },
  });

  const replaced = reduceTranscriptState(withTodo, {
    type: "replace_items",
    items: [{
      type: "assistant",
      id: "a1",
      text: "Resumed session",
      isPending: false,
      ts: 1,
    }],
  });

  assertEquals(replaced.activePlan, undefined);
  assertEquals(replaced.todoState, undefined);
  assertEquals(replaced.planTodoState, undefined);
  assertEquals(replaced.completedPlanStepIds, []);
});

Deno.test("agent transcript state tracks plan review resolution state", () => {
  const withReview = reduceTranscriptState(createTranscriptState(), {
    type: "agent_event",
    event: {
      type: "plan_review_required",
      plan: {
        goal: "Review file edits",
        steps: [{ id: "step-1", title: "Edit config" }],
      },
    },
  });

  const resolved = reduceTranscriptState(withReview, {
    type: "agent_event",
    event: {
      type: "plan_review_resolved",
      plan: {
        goal: "Review file edits",
        steps: [{ id: "step-1", title: "Edit config" }],
      },
      approved: true,
    },
  });

  assertEquals(withReview.pendingPlanReview?.plan.goal, "Review file edits");
  assertEquals(resolved.pendingPlanReview, undefined);
});

Deno.test("agent transcript state preserves structured team lifecycle metadata", () => {
  const withTask = reduceTranscriptState(createTranscriptState(), {
    type: "agent_event",
    event: {
      type: "team_task_updated",
      taskId: "task-1",
      goal: "Review patch",
      status: "in_progress",
      assigneeMemberId: "worker-1",
    },
  });

  const withMessage = reduceTranscriptState(withTask, {
    type: "agent_event",
    event: {
      type: "team_message",
      kind: "direct",
      fromMemberId: "worker-1",
      toMemberId: "lead",
      relatedTaskId: "task-1",
      contentPreview: "Need clarification on scope",
    },
  });

  assertEquals(withMessage.items.map((item) => item.type), ["info", "info"]);
  assertEquals(isStructuredTeamInfoItem(withMessage.items[0]!), true);
  if (
    withMessage.items[0] &&
    isStructuredTeamInfoItem(withMessage.items[0]) &&
    withMessage.items[0].teamEventType === "team_task_updated"
  ) {
    assertEquals(withMessage.items[0].teamEventType, "team_task_updated");
    assertEquals(withMessage.items[0].taskId, "task-1");
    assertEquals(withMessage.items[0].assigneeMemberId, "worker-1");
    assertEquals(
      withMessage.items[0].text,
      "Team task in_progress: Review patch (worker-1)",
    );
  }
  assertEquals(isStructuredTeamInfoItem(withMessage.items[1]!), true);
  if (
    withMessage.items[1] &&
    isStructuredTeamInfoItem(withMessage.items[1]) &&
    withMessage.items[1].teamEventType === "team_message"
  ) {
    assertEquals(withMessage.items[1].teamEventType, "team_message");
    assertEquals(withMessage.items[1].relatedTaskId, "task-1");
    assertEquals(
      withMessage.items[1].text,
      "Team direct: worker-1 -> lead: Need clarification on scope",
    );
  }
});

Deno.test("agent transcript state accepts team-sourced todo updates", () => {
  const next = reduceTranscriptState(createTranscriptState(), {
    type: "agent_event",
    event: {
      type: "todo_updated",
      todoState: {
        items: [{
          id: "task-1",
          content: "Review patch",
          status: "in_progress",
        }],
      },
      source: "team",
    },
  });

  assertEquals(next.todoState?.items.length, 1);
  assertEquals(next.todoState?.items[0]?.id, "task-1");
});

Deno.test("agent transcript state records batch progress updates as info items", () => {
  const next = reduceTranscriptState(createTranscriptState(), {
    type: "agent_event",
    event: {
      type: "batch_progress_updated",
      snapshot: {
        batchId: "batch-1",
        agent: "code",
        totalRows: 4,
        queued: 1,
        running: 2,
        completed: 1,
        errored: 0,
        cancelled: 0,
        spawned: 4,
        spawnFailures: 0,
        createdAt: 1,
        status: "running",
        threadIds: ["t1", "t2", "t3", "t4"],
      },
    },
  });

  assertEquals(next.items.length, 1);
  assertEquals(next.items[0]?.type, "info");
  if (next.items[0]?.type === "info") {
    assertEquals(
      next.items[0].text,
      "Batch batch-1: 2 running · 1 completed · 0 errored",
    );
  }
});

Deno.test("agent transcript state tracks planning phase without duplicating clarification prompts", () => {
  let state = reduceTranscriptState(createTranscriptState(), {
    type: "agent_event",
    event: {
      type: "plan_phase_changed",
      phase: "researching",
    },
  });

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "interaction_request",
      requestId: "req-1",
      mode: "question",
      question: "Which for-loop style do you want?",
    },
  });

  assertEquals(state.planningPhase, "researching");
  assertEquals(state.streamingState, "waiting_for_confirmation");
  assertEquals(state.items.length, 0);
});

Deno.test("agent transcript state hides planning and reasoning updates once plan execution has started", () => {
  let state = reduceTranscriptState(createTranscriptState(), {
    type: "agent_event",
    event: {
      type: "plan_phase_changed",
      phase: "executing",
    },
  });

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "reasoning_update",
      iteration: 1,
      summary: "Thinking through the next step.",
    },
  });
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "planning_update",
      iteration: 1,
      summary: "Read the file before editing.",
    },
  });

  assertEquals(state.items.length, 0);
});

Deno.test("agent transcript state preserves items during plan phase transitions", () => {
  let state = reduceTranscriptState(createTranscriptState(), {
    type: "user_message",
    text: "plan this edit",
  });
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "planning_update",
      iteration: 1,
      summary: "Inspect the target file.",
    },
  });
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "reasoning_update",
      iteration: 1,
      summary: "Need one more read before editing.",
    },
  });

  const itemCountBefore = state.items.length;
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "plan_phase_changed",
      phase: "executing",
    },
  });

  // Items are preserved — no screen flush on phase transition
  assertEquals(state.items.length, itemCountBefore);
  assertEquals(state.planningPhase, "executing");
});

// ============================================================
// HQL eval — insertion + turnId
// ============================================================

Deno.test("hql_eval during Responding is appended into transcript items and keeps the active turnId", () => {
  // Set up state with user + pending assistant + currentTurnId
  let state = createTranscriptState();
  state = reduceTranscriptState(state, {
    type: "user_message",
    text: "hello",
    startTurn: true,
  });
  // state now has user + pending assistant, with a currentTurnId
  assertEquals(state.currentTurnId, "turn-1");
  const itemsBefore = state.items.length; // user + pending assistant = 2
  assertEquals(itemsBefore, 2);

  const next = reduceTranscriptState(state, {
    type: "hql_eval",
    input: "(+ 1 2)",
    result: { success: true, value: "3" },
  });
  assertEquals(next.items.length, 3);
  assertEquals(next.items[1].type, "assistant");
  assertEquals(next.items[2]?.type, "hql_eval");
  const evalItem = next.items[2];
  if (evalItem) {
    assertEquals(evalItem.turnId, "turn-1");
  }
});

Deno.test("hql_eval during Idle gets its own ephemeral turnId", () => {
  const state = createTranscriptState();
  const next = reduceTranscriptState(state, {
    type: "hql_eval",
    input: "(+ 1 2)",
    result: { success: true, value: "3" },
  });
  assertEquals(next.items.length, 1);
  assertEquals(next.items[0]?.type, "hql_eval");
  // Should have an ephemeral turnId
  const evalItem = next.items[0];
  if (evalItem) {
    assertEquals(evalItem.turnId, "turn-1");
  }
  assertEquals(next.turnCounter, 1);
});

// ============================================================
// Turn grouping via turnId
// ============================================================

Deno.test("user_message with startTurn generates turnId", () => {
  const state = createTranscriptState();
  const next = reduceTranscriptState(state, {
    type: "user_message",
    text: "hello",
    startTurn: true,
  });
  assertEquals(next.currentTurnId, "turn-1");
  assertEquals(next.turnCounter, 1);
  // User item and pending assistant both get the turnId
  const userItem = next.items[0];
  const assistantItem = next.items[1];
  assertEquals(userItem.type, "user");
  if (userItem.type === "user") {
    assertEquals(userItem.turnId, "turn-1");
  }
  assertEquals(assistantItem.type, "assistant");
  if (assistantItem.type === "assistant") {
    assertEquals(assistantItem.turnId, "turn-1");
  }
});

Deno.test("turnId propagates through agent_event sub-cases", () => {
  let state = createTranscriptState();
  // Start a turn
  state = reduceTranscriptState(state, {
    type: "user_message",
    text: "hello",
    startTurn: true,
  });
  assertEquals(state.currentTurnId, "turn-1");

  // Dispatch tool_start
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "tool_start",
      name: "read_file",
      argsSummary: "test.ts",
      toolIndex: 1,
      toolTotal: 1,
    },
  });
  // Find the tool_group item
  const toolGroup = state.items.find((i) => i.type === "tool_group");
  assertEquals(toolGroup?.type, "tool_group");
  if (toolGroup?.type === "tool_group") {
    assertEquals(toolGroup.turnId, "turn-1");
  }
});

Deno.test("finalize clears currentTurnId after committing pending turn stats", () => {
  let state = createTranscriptState();
  state = reduceTranscriptState(state, {
    type: "user_message",
    text: "hello",
    startTurn: true,
  });
  assertEquals(state.currentTurnId, "turn-1");

  // Add some text so finalize doesn't strip the assistant
  state = reduceTranscriptState(state, {
    type: "assistant_text",
    text: "world",
    isPending: false,
  });

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "turn_stats",
      iteration: 1,
      toolCount: 0,
      durationMs: 100,
    },
  });

  assertEquals(state.currentTurnId, "turn-1");
  assertEquals(state.items.some((i) => i.type === "turn_stats"), false);

  state = reduceTranscriptState(state, {
    type: "finalize",
    status: "completed",
  });
  assertEquals(state.currentTurnId, undefined);
  const statsItem = state.items.find((i) => i.type === "turn_stats");
  if (statsItem?.type === "turn_stats") {
    assertEquals(statsItem.turnId, "turn-1");
    assertEquals(statsItem.status, "completed");
  }
});

Deno.test("turnCounter increments monotonically", () => {
  let state = createTranscriptState();
  assertEquals(state.turnCounter, 0);

  // First turn
  state = reduceTranscriptState(state, {
    type: "user_message",
    text: "first",
    startTurn: true,
  });
  assertEquals(state.currentTurnId, "turn-1");
  assertEquals(state.turnCounter, 1);

  // End first turn
  state = reduceTranscriptState(state, {
    type: "assistant_text",
    text: "reply",
    isPending: false,
  });
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: { type: "turn_stats", iteration: 1, toolCount: 0, durationMs: 50 },
  });
  state = reduceTranscriptState(state, {
    type: "finalize",
    status: "completed",
  });

  // Second turn
  state = reduceTranscriptState(state, {
    type: "user_message",
    text: "second",
    startTurn: true,
  });
  assertEquals(state.currentTurnId, "turn-2");
  assertEquals(state.turnCounter, 2);
});

Deno.test("capability_routed de-duplicates repeated route summaries within a turn", () => {
  let state = reduceTranscriptState(createTranscriptState(), {
    type: "user_message",
    text: "hello",
    startTurn: true,
  });

  const routedEvent = {
    type: "capability_routed" as const,
    routePhase: "tool-start" as const,
    runtimeMode: "auto" as const,
    familyId: "web" as const,
    capabilityId: "web.search" as const,
    strategy: "configured-first" as const,
    selectedBackendKind: "hlvm-local" as const,
    selectedToolName: "search_web",
    providerName: "test-chat",
    fallbackReason: "provider-native unavailable; no participating MCP route",
    candidates: [],
    summary:
      "Tool-start route web.search -> HLVM local (provider-native unavailable; no participating MCP route)",
  };

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: routedEvent,
  });
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      ...routedEvent,
      summary: "duplicate summary text should be ignored",
    },
  });

  const infoItems = state.items.filter((item) => item.type === "info");
  assertEquals(infoItems.length, 1);
});

Deno.test("capability_routed emits again when the selected route changes within a turn", () => {
  let state = reduceTranscriptState(createTranscriptState(), {
    type: "user_message",
    text: "hello",
    startTurn: true,
  });

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "capability_routed",
      routePhase: "tool-start",
      runtimeMode: "auto",
      familyId: "web",
      capabilityId: "web.search",
      strategy: "configured-first",
      selectedBackendKind: "provider-native",
      selectedToolName: "web_search",
      providerName: "openai",
      candidates: [],
      summary: "Tool-start route web.search -> provider-native (openai)",
    },
  });
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "capability_routed",
      routePhase: "tool-start",
      runtimeMode: "auto",
      familyId: "web",
      capabilityId: "web.search",
      strategy: "configured-first",
      selectedBackendKind: "hlvm-local",
      selectedToolName: "search_web",
      providerName: "openai",
      fallbackReason: "task constraints local-only",
      candidates: [],
      summary: "Tool-start route web.search -> HLVM local (task constraints local-only)",
    },
  });

  const infoItems = state.items.filter((item) => item.type === "info");
  assertEquals(infoItems.length, 2);
});

Deno.test("capability_routed de-duplication resets on a new turn", () => {
  let state = reduceTranscriptState(createTranscriptState(), {
    type: "user_message",
    text: "first",
    startTurn: true,
  });

  const routedEvent = {
    type: "capability_routed" as const,
    routePhase: "turn-start" as const,
    runtimeMode: "auto" as const,
    familyId: "vision" as const,
    capabilityId: "vision.analyze" as const,
    strategy: "configured-first" as const,
    selectedBackendKind: "provider-native" as const,
    providerName: "test-chat",
    candidates: [],
    summary: "Turn-start route vision.analyze -> provider-native (test-chat)",
  };

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: routedEvent,
  });
  state = reduceTranscriptState(state, {
    type: "user_message",
    text: "second",
    startTurn: true,
  });
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: routedEvent,
  });

  const infoItems = state.items.filter((item) => item.type === "info");
  assertEquals(infoItems.length, 2);
});

// ── Delegate Group (batchId) Tests ───────────────────────────

Deno.test("delegate_start with batchId creates DelegateGroupItem with queued status", () => {
  let state = createTranscriptState();
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_start",
      agent: "researcher",
      task: "Search docs",
      batchId: "batch-1",
      threadId: "t1",
    },
  });
  const groups = state.items.filter((i) => i.type === "delegate_group");
  assertEquals(groups.length, 1);
  if (groups[0].type === "delegate_group") {
    assertEquals(groups[0].batchId, "batch-1");
    assertEquals(groups[0].entries.length, 1);
    assertEquals(groups[0].entries[0].agent, "researcher");
    assertEquals(groups[0].entries[0].status, "queued");
  }
});

Deno.test("second delegate_start with same batchId appends to existing group", () => {
  let state = createTranscriptState();
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_start",
      agent: "researcher",
      task: "Search docs",
      batchId: "batch-1",
      threadId: "t1",
    },
  });
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_start",
      agent: "coder",
      task: "Write code",
      batchId: "batch-1",
      threadId: "t2",
    },
  });
  const groups = state.items.filter((i) => i.type === "delegate_group");
  assertEquals(groups.length, 1);
  if (groups[0].type === "delegate_group") {
    assertEquals(groups[0].entries.length, 2);
    assertEquals(groups[0].entries[0].agent, "researcher");
    assertEquals(groups[0].entries[1].agent, "coder");
  }
});

Deno.test("delegate_end with batchId updates correct entry in group", () => {
  let state = createTranscriptState();
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_start",
      agent: "researcher",
      task: "Search docs",
      batchId: "batch-1",
      threadId: "t1",
    },
  });
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_start",
      agent: "coder",
      task: "Write code",
      batchId: "batch-1",
      threadId: "t2",
    },
  });
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_end",
      agent: "researcher",
      task: "Search docs",
      success: true,
      summary: "Found 3 results",
      durationMs: 1200,
      batchId: "batch-1",
      threadId: "t1",
    },
  });
  const groups = state.items.filter((i) => i.type === "delegate_group");
  assertEquals(groups.length, 1);
  if (groups[0].type === "delegate_group") {
    assertEquals(groups[0].entries[0].status, "success");
    assertEquals(groups[0].entries[0].summary, "Found 3 results");
    assertEquals(groups[0].entries[1].status, "queued");
  }
});

Deno.test("delegate_start without batchId creates individual DelegateItem (regression)", () => {
  let state = createTranscriptState();
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_start",
      agent: "solo",
      task: "Do something",
    },
  });
  const delegates = state.items.filter((i) => i.type === "delegate");
  const groups = state.items.filter((i) => i.type === "delegate_group");
  assertEquals(delegates.length, 1);
  assertEquals(groups.length, 0);
});

Deno.test("delegate_running transitions queued group entry to running", () => {
  let state = createTranscriptState();
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_start",
      agent: "researcher",
      task: "Search docs",
      batchId: "batch-1",
      threadId: "t1",
    },
  });
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_start",
      agent: "coder",
      task: "Write code",
      batchId: "batch-1",
      threadId: "t2",
    },
  });
  // Both should start as queued
  const groupBefore = state.items.find((i) => i.type === "delegate_group");
  if (groupBefore?.type === "delegate_group") {
    assertEquals(groupBefore.entries[0].status, "queued");
    assertEquals(groupBefore.entries[1].status, "queued");
  }
  // Transition t1 to running
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_running",
      threadId: "t1",
    },
  });
  const groupAfter = state.items.find((i) => i.type === "delegate_group");
  if (groupAfter?.type === "delegate_group") {
    assertEquals(groupAfter.entries[0].status, "running");
    assertEquals(groupAfter.entries[1].status, "queued");
  }
});

Deno.test("delegate_running with no matching group entry returns state unchanged", () => {
  let state = createTranscriptState();
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_start",
      agent: "researcher",
      task: "Search docs",
      batchId: "batch-1",
      threadId: "t1",
    },
  });
  // Transition t1 to running first
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_running",
      threadId: "t1",
    },
  });
  // Now try delegate_running for an unknown threadId — should be a no-op
  const stateBefore = state;
  const stateAfter = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_running",
      threadId: "t999",
    },
  });
  assertEquals(stateAfter.items, stateBefore.items);
});

Deno.test("batch_progress_updated suppressed when delegate group exists", () => {
  let state = createTranscriptState();
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_start",
      agent: "researcher",
      task: "Search",
      batchId: "batch-1",
      threadId: "t1",
    },
  });
  const beforeCount = state.items.length;
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "batch_progress_updated",
      snapshot: {
        batchId: "batch-1",
        agent: "researcher",
        totalRows: 1,
        threadIds: ["t1"],
        spawnFailures: 0,
        createdAt: 0,
        spawned: 1,
        queued: 0,
        running: 1,
        completed: 0,
        errored: 0,
        cancelled: 0,
        status: "running" as const,
      },
    },
  });
  // No new info item should be added since the group already shows the data
  assertEquals(state.items.length, beforeCount);
});

Deno.test("agent transcript state tracks web-search progress and transcript summaries", () => {
  let state = reduceTranscriptState(createTranscriptState(), {
    type: "agent_event",
    event: {
      type: "tool_start",
      name: "search_web",
      toolCallId: "tool-call-1",
      argsSummary: "react 19 release notes",
      toolIndex: 1,
      toolTotal: 1,
    },
  });

  assertEquals(state.activeTool?.displayName, "Web Search");
  assertEquals(state.activeTool?.progressText, "Searching: react 19 release notes");

  const startedGroup = state.items.find((item) => item.type === "tool_group");
  assertEquals(startedGroup?.type, "tool_group");
  if (startedGroup?.type === "tool_group") {
    assertEquals(startedGroup.tools[0]?.displayName, "Web Search");
    assertEquals(
      startedGroup.tools[0]?.progressText,
      "Searching: react 19 release notes",
    );
  }

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "tool_progress",
      name: "search_web",
      toolCallId: "tool-call-1",
      argsSummary: "react 19 release notes",
      message: 'Found 10 results for "react 19 release notes"',
      tone: "running",
      phase: "results",
    },
  });

  assertEquals(
    state.activeTool?.progressText,
    'Found 10 results for "react 19 release notes"',
  );

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "tool_end",
      name: "search_web",
      toolCallId: "tool-call-1",
      success: true,
      content: 'Top sources for "react 19 release notes"',
      durationMs: 1700,
      argsSummary: "react 19 release notes",
    },
  });

  assertEquals(state.activeTool, undefined);
  const finishedGroup = state.items.find((item) => item.type === "tool_group");
  assertEquals(finishedGroup?.type, "tool_group");
  if (finishedGroup?.type === "tool_group") {
    const tool = finishedGroup.tools[0];
    assertEquals(tool?.status, "success");
    assertEquals(tool?.progressText, undefined);
    assertEquals(tool?.resultSummaryText, "Did 1 search in 1.7s");
    assertEquals(
      tool?.resultDetailText,
      'Top sources for "react 19 release notes"',
    );
  }
});
