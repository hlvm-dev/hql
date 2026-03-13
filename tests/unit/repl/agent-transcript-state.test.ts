import { assertEquals } from "jsr:@std/assert";
import {
  createTranscriptState,
  reduceTranscriptState,
} from "../../../src/hlvm/cli/agent-transcript-state.ts";
import {
  type ConversationItem,
  isStructuredTeamInfoItem,
} from "../../../src/hlvm/cli/repl-ink/types.ts";

function withItems(items: ConversationItem[]) {
  return {
    ...createTranscriptState(),
    items,
    nextId: items.length,
  };
}

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

  const next = reduceTranscriptState(state, { type: "finalize" });

  assertEquals(next.items.map((item) => item.type), ["user", "assistant"]);
  assertEquals(next.items[1]?.type, "assistant");
  if (next.items[1]?.type === "assistant") {
    assertEquals(next.items[1].text, "partial answer");
    assertEquals(next.items[1].isPending, false);
  }
});

Deno.test("agent transcript state keeps provider reasoning summaries and drops generic working rows", () => {
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

  const finalized = reduceTranscriptState(state, { type: "finalize" });
  assertEquals(finalized.items.length, 1);
  assertEquals(finalized.items[0]?.type, "thinking");
  if (finalized.items[0]?.type === "thinking") {
    assertEquals(finalized.items[0].kind, "reasoning");
  }
});

Deno.test("agent transcript state records fallback planning separately from provider reasoning", () => {
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
    assertEquals(next.items[0].kind, "planning");
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
      "reasoning:Inspect parser.ts before editing.",
      "planning:Patch only the import path.",
    ],
  );
});

Deno.test("agent transcript state preserves prior-turn reasoning when later turns reuse iteration numbers", () => {
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

  state = reduceTranscriptState(state, { type: "finalize" });
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
      "First-turn reasoning",
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

Deno.test("agent transcript state keeps only the latest turn stats for the active user turn", () => {
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
    1,
  );
  assertEquals(secondStats.items.at(-1)?.type, "turn_stats");
  const latestItem = secondStats.items.at(-1);
  if (latestItem?.type === "turn_stats") {
    assertEquals(latestItem.toolCount, 2);
    assertEquals(latestItem.durationMs, 2000);
  }
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

Deno.test("agent transcript state tracks plan review and checkpoint safety state", () => {
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

  const withCheckpoint = reduceTranscriptState(withReview, {
    type: "agent_event",
    event: {
      type: "checkpoint_created",
      checkpoint: {
        id: "cp-1",
        requestId: "req-1",
        createdAt: 1,
        fileCount: 2,
        reversible: true,
      },
    },
  });

  const restored = reduceTranscriptState(withCheckpoint, {
    type: "agent_event",
    event: {
      type: "checkpoint_restored",
      checkpoint: {
        id: "cp-1",
        requestId: "req-1",
        createdAt: 1,
        fileCount: 2,
        reversible: true,
        restoredAt: 2,
      },
      restoredFileCount: 2,
    },
  });

  const resolved = reduceTranscriptState(restored, {
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
  assertEquals(withCheckpoint.latestCheckpoint?.fileCount, 2);
  assertEquals(restored.latestCheckpoint?.restoredAt, 2);
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
