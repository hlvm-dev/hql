import { assertEquals } from "jsr:@std/assert";
import {
  createTranscriptState,
  reduceTranscriptState,
} from "../../../src/hlvm/cli/agent-transcript-state.ts";
import type { ConversationItem } from "../../../src/hlvm/cli/repl-ink/types.ts";

function withItems(items: ConversationItem[]) {
  return {
    ...createTranscriptState(),
    items,
    nextId: items.length,
  };
}

Deno.test("agent transcript state inserts a final assistant response before trailing turn stats", () => {
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
    "turn_stats",
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

Deno.test("agent transcript state records team lifecycle events as info items", () => {
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
  assertEquals(withMessage.items[0]?.type, "info");
  if (withMessage.items[0]?.type === "info") {
    assertEquals(
      withMessage.items[0].text,
      "Team task in_progress: Review patch (worker-1)",
    );
  }
  assertEquals(withMessage.items[1]?.type, "info");
  if (withMessage.items[1]?.type === "info") {
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
