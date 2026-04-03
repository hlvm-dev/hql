/**
 * Team Event Rendering E2E Tests
 *
 * Exercises the full pipeline: AgentUIEvent → reducer → StructuredTeamInfoItem
 * → isStructuredTeamInfoItem type guard → chrome tone/glyph functions → footer state.
 *
 * This validates that team events flow correctly from orchestrator events all
 * the way through to the visual primitives that TeamEventItem.tsx consumes.
 */

import { assertEquals } from "jsr:@std/assert@1";
import {
  createTranscriptState,
  reduceTranscriptState,
} from "../../../src/hlvm/cli/agent-transcript-state.ts";
import {
  isStructuredTeamInfoItem,
  type TeamMemberActivityInfoItem,
  type TeamMessageInfoItem,
  type TeamPlanReviewInfoItem,
  type TeamShutdownInfoItem,
  type TeamTaskInfoItem,
} from "../../../src/hlvm/cli/repl-ink/types.ts";
import type { AgentUIEvent } from "../../../src/hlvm/agent/orchestrator.ts";
import {
  getTeamMessageGlyph,
  getTeamMessageTone,
  getTeamPlanReviewGlyph,
  getTeamPlanReviewTone,
  getTeamShutdownGlyph,
  getTeamShutdownTone,
  getTeamTaskStatusGlyph,
  getTeamTaskStatusTone,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/conversation-chrome.ts";
import { buildFooterLeftState } from "../../../src/hlvm/cli/repl-ink/components/FooterHint.tsx";
import { StreamingState } from "../../../src/hlvm/cli/repl-ink/types.ts";

// ── Helper ────────────────────────────────────────────────

function pushEvent(
  state: ReturnType<typeof createTranscriptState>,
  event: AgentUIEvent,
) {
  return reduceTranscriptState(state, { type: "agent_event", event });
}

// ── E2E: Full team lifecycle through reducer + chrome ─────

Deno.test("E2E: team_task_updated flows through reducer to correct tone/glyph", () => {
  const state = pushEvent(createTranscriptState(), {
    type: "team_task_updated",
    taskId: "t-1",
    goal: "Implement auth",
    status: "in_progress",
    assigneeMemberId: "alice",
  });

  assertEquals(state.items.length, 1);
  const item = state.items[0]!;
  assertEquals(item.type, "info");
  assertEquals(isStructuredTeamInfoItem(item), true);

  const task = item as TeamTaskInfoItem;
  assertEquals(task.teamEventType, "team_task_updated");
  assertEquals(task.taskId, "t-1");
  assertEquals(task.goal, "Implement auth");
  assertEquals(task.status, "in_progress");
  assertEquals(task.assigneeMemberId, "alice");
  assertEquals(task.text, "Team task in_progress: Implement auth (alice)");

  // Chrome produces correct visuals for this status
  assertEquals(getTeamTaskStatusTone(task.status), "active");
  assertEquals(getTeamTaskStatusGlyph(task.status), "●");
});

Deno.test("E2E: team_task_updated without assignee omits parenthetical", () => {
  const state = pushEvent(createTranscriptState(), {
    type: "team_task_updated",
    taskId: "t-2",
    goal: "Run tests",
    status: "completed",
  });

  const task = state.items[0] as TeamTaskInfoItem;
  assertEquals(task.text, "Team task completed: Run tests");
  assertEquals(getTeamTaskStatusTone(task.status), "success");
  assertEquals(getTeamTaskStatusGlyph(task.status), "✓");
});

Deno.test("E2E: team_message DM flows through reducer to correct tone/glyph", () => {
  const state = pushEvent(createTranscriptState(), {
    type: "team_message",
    kind: "message",
    fromMemberId: "alice",
    toMemberId: "lead",
    relatedTaskId: "t-1",
    contentPreview: "Need clarification",
  });

  assertEquals(state.items.length, 1);
  const msg = state.items[0] as TeamMessageInfoItem;
  assertEquals(msg.teamEventType, "team_message");
  assertEquals(msg.fromMemberId, "alice");
  assertEquals(msg.toMemberId, "lead");
  assertEquals(msg.contentPreview, "Need clarification");
  assertEquals(msg.text, "Team message: alice -> lead: Need clarification");

  assertEquals(getTeamMessageTone(msg.kind), "active");
  assertEquals(getTeamMessageGlyph(msg.kind), "✉");
});

Deno.test("E2E: team_message broadcast omits arrow", () => {
  const state = pushEvent(createTranscriptState(), {
    type: "team_message",
    kind: "broadcast",
    fromMemberId: "lead",
    contentPreview: "All stop",
  });

  const msg = state.items[0] as TeamMessageInfoItem;
  assertEquals(msg.text, "Team broadcast: lead: All stop");
  assertEquals(msg.toMemberId, undefined);
  assertEquals(getTeamMessageTone(msg.kind), "active");
  assertEquals(getTeamMessageGlyph(msg.kind), "📢");
});

Deno.test("E2E: team_message task_completed kind has success tone", () => {
  const state = pushEvent(createTranscriptState(), {
    type: "team_message",
    kind: "task_completed",
    fromMemberId: "alice",
    toMemberId: "lead",
    contentPreview: "Done with auth",
  });

  const msg = state.items[0] as TeamMessageInfoItem;
  assertEquals(getTeamMessageTone(msg.kind), "success");
  assertEquals(getTeamMessageGlyph(msg.kind), "✓");
});

Deno.test("E2E: team_member_activity flows through reducer with worker summary", () => {
  const state = pushEvent(createTranscriptState(), {
    type: "team_member_activity",
    memberId: "alice",
    memberLabel: "alice",
    threadId: "thread-1",
    activityKind: "tool_end",
    summary: "Tool TaskList: 2 tasks",
    status: "success",
  });

  assertEquals(state.items.length, 1);
  const activity = state.items[0] as TeamMemberActivityInfoItem;
  assertEquals(activity.teamEventType, "team_member_activity");
  assertEquals(activity.memberId, "alice");
  assertEquals(activity.threadId, "thread-1");
  assertEquals(activity.summary, "Tool TaskList: 2 tasks");
  assertEquals(activity.text, "Team worker alice: Tool TaskList: 2 tasks");
});

Deno.test("E2E: team_plan_review_required flows through as pending plan review", () => {
  const state = pushEvent(createTranscriptState(), {
    type: "team_plan_review_required",
    approvalId: "apr-1",
    taskId: "t-1",
    submittedByMemberId: "alice",
  });

  assertEquals(state.items.length, 1);
  const review = state.items[0] as TeamPlanReviewInfoItem;
  assertEquals(review.teamEventType, "team_plan_review");
  assertEquals(review.approvalId, "apr-1");
  assertEquals(review.taskId, "t-1");
  assertEquals(review.submittedByMemberId, "alice");
  assertEquals(review.status, "pending");
  assertEquals(review.text, "Team plan review requested for task t-1");

  assertEquals(getTeamPlanReviewTone(review.status), "warning");
  assertEquals(getTeamPlanReviewGlyph(review.status), "○");
});

Deno.test("E2E: team_plan_review_resolved approved flows through with success", () => {
  const state = pushEvent(createTranscriptState(), {
    type: "team_plan_review_resolved",
    approvalId: "apr-1",
    taskId: "t-1",
    submittedByMemberId: "alice",
    approved: true,
    reviewedByMemberId: "lead",
  });

  const review = state.items[0] as TeamPlanReviewInfoItem;
  assertEquals(review.status, "approved");
  assertEquals(review.reviewedByMemberId, "lead");
  assertEquals(review.text, "Team plan review approved for task t-1");

  assertEquals(getTeamPlanReviewTone(review.status), "success");
  assertEquals(getTeamPlanReviewGlyph(review.status), "✓");
});

Deno.test("E2E: team_plan_review_resolved rejected flows through with error", () => {
  const state = pushEvent(createTranscriptState(), {
    type: "team_plan_review_resolved",
    approvalId: "apr-2",
    taskId: "t-2",
    submittedByMemberId: "bob",
    approved: false,
  });

  const review = state.items[0] as TeamPlanReviewInfoItem;
  assertEquals(review.status, "rejected");
  assertEquals(review.reviewedByMemberId, undefined);
  assertEquals(review.text, "Team plan review rejected for task t-2");

  assertEquals(getTeamPlanReviewTone(review.status), "error");
  assertEquals(getTeamPlanReviewGlyph(review.status), "✗");
});

Deno.test("E2E: team_shutdown_requested flows through with warning", () => {
  const state = pushEvent(createTranscriptState(), {
    type: "team_shutdown_requested",
    requestId: "shut-1",
    memberId: "alice",
    requestedByMemberId: "lead",
    reason: "Task complete",
  });

  assertEquals(state.items.length, 1);
  const shutdown = state.items[0] as TeamShutdownInfoItem;
  assertEquals(shutdown.teamEventType, "team_shutdown");
  assertEquals(shutdown.requestId, "shut-1");
  assertEquals(shutdown.memberId, "alice");
  assertEquals(shutdown.requestedByMemberId, "lead");
  assertEquals(shutdown.status, "requested");
  assertEquals(shutdown.reason, "Task complete");
  assertEquals(shutdown.text, "Shutdown requested for alice: Task complete");

  assertEquals(getTeamShutdownTone(shutdown.status), "warning");
  assertEquals(getTeamShutdownGlyph(shutdown.status), "⚠");
});

Deno.test("E2E: team_shutdown_requested without reason omits suffix", () => {
  const state = pushEvent(createTranscriptState(), {
    type: "team_shutdown_requested",
    requestId: "shut-2",
    memberId: "bob",
    requestedByMemberId: "lead",
  });

  const shutdown = state.items[0] as TeamShutdownInfoItem;
  assertEquals(shutdown.text, "Shutdown requested for bob");
  assertEquals(shutdown.reason, undefined);
});

Deno.test("E2E: team_shutdown_resolved acknowledged flows through with active", () => {
  const state = pushEvent(createTranscriptState(), {
    type: "team_shutdown_resolved",
    requestId: "shut-1",
    memberId: "alice",
    requestedByMemberId: "lead",
    status: "acknowledged",
  });

  const shutdown = state.items[0] as TeamShutdownInfoItem;
  assertEquals(shutdown.status, "acknowledged");
  assertEquals(shutdown.text, "Shutdown acknowledged for alice");

  assertEquals(getTeamShutdownTone(shutdown.status), "active");
  assertEquals(getTeamShutdownGlyph(shutdown.status), "●");
});

Deno.test("E2E: team_shutdown_resolved forced flows through with error", () => {
  const state = pushEvent(createTranscriptState(), {
    type: "team_shutdown_resolved",
    requestId: "shut-3",
    memberId: "charlie",
    requestedByMemberId: "lead",
    status: "forced",
  });

  const shutdown = state.items[0] as TeamShutdownInfoItem;
  assertEquals(shutdown.status, "forced");
  assertEquals(shutdown.text, "Shutdown forced for charlie");

  assertEquals(getTeamShutdownTone(shutdown.status), "error");
  assertEquals(getTeamShutdownGlyph(shutdown.status), "✗");
});

// ── E2E: Multi-event sequence ─────────────────────────────

Deno.test("E2E: full team lifecycle produces correct item sequence", () => {
  let state = createTranscriptState();

  // 1. Task created
  state = pushEvent(state, {
    type: "team_task_updated",
    taskId: "t-1",
    goal: "Build feature",
    status: "pending",
  });
  // 2. Task claimed
  state = pushEvent(state, {
    type: "team_task_updated",
    taskId: "t-1",
    goal: "Build feature",
    status: "in_progress",
    assigneeMemberId: "alice",
  });
  // 3. Worker sends message
  state = pushEvent(state, {
    type: "team_message",
    kind: "message",
    fromMemberId: "alice",
    toMemberId: "lead",
    contentPreview: "Starting work",
  });
  // 4. Plan review requested
  state = pushEvent(state, {
    type: "team_plan_review_required",
    approvalId: "apr-1",
    taskId: "t-1",
    submittedByMemberId: "alice",
  });
  // 5. Plan approved
  state = pushEvent(state, {
    type: "team_plan_review_resolved",
    approvalId: "apr-1",
    taskId: "t-1",
    submittedByMemberId: "alice",
    approved: true,
    reviewedByMemberId: "lead",
  });
  // 6. Task completed
  state = pushEvent(state, {
    type: "team_task_updated",
    taskId: "t-1",
    goal: "Build feature",
    status: "completed",
    assigneeMemberId: "alice",
  });
  // 7. Shutdown requested
  state = pushEvent(state, {
    type: "team_shutdown_requested",
    requestId: "shut-1",
    memberId: "alice",
    requestedByMemberId: "lead",
  });
  // 8. Shutdown acknowledged
  state = pushEvent(state, {
    type: "team_shutdown_resolved",
    requestId: "shut-1",
    memberId: "alice",
    requestedByMemberId: "lead",
    status: "acknowledged",
  });

  assertEquals(state.items.length, 8);
  // Every item must be a structured team info item
  for (const item of state.items) {
    assertEquals(item.type, "info");
    assertEquals(isStructuredTeamInfoItem(item), true);
  }

  // Verify the event type sequence
  const types = state.items.map((item) => {
    if (isStructuredTeamInfoItem(item)) return item.teamEventType;
    return "unknown";
  });
  assertEquals(types, [
    "team_task_updated",
    "team_task_updated",
    "team_message",
    "team_plan_review",
    "team_plan_review",
    "team_task_updated",
    "team_shutdown",
    "team_shutdown",
  ]);

  // Spot-check: last item is acknowledged shutdown
  const last = state.items[7] as TeamShutdownInfoItem;
  assertEquals(last.status, "acknowledged");
  assertEquals(getTeamShutdownTone(last.status), "active");
});

// ── E2E: Footer integration ──────────────────────────────

Deno.test("E2E: footer leaves team status to the compact background footer", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    teamActive: true,
    teamAttentionCount: 2,
    teamWorkerSummary: "alice: working \u00B7 bob: idle",
    spinner: "x",
  });

  assertEquals(state.mode, "segments");
  assertEquals(
    state.segments.some((s) => s.text === "Team"),
    false,
  );
  assertEquals(
    state.segments.some((s) => s.text.includes("alice")),
    false,
  );
  assertEquals(
    state.segments.some((s) => s.text === "Ctrl+T manager"),
    false,
  );
});

Deno.test("E2E: footer omits team segments when team inactive", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    teamActive: false,
    spinner: "x",
  });

  assertEquals(
    state.segments.some((s) => s.text === "Team"),
    false,
  );
  assertEquals(
    state.segments.some((s) => s.text.includes("working")),
    false,
  );
});
