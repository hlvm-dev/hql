import { assertEquals } from "jsr:@std/assert";
import { createDefaultTeamPolicy } from "../../../src/hlvm/agent/team-runtime.ts";
import { deriveTeamDashboardState } from "../../../src/hlvm/cli/repl-ink/hooks/useTeamState.ts";
import type { ConversationItem } from "../../../src/hlvm/cli/repl-ink/types.ts";

Deno.test("deriveTeamDashboardState uses structured team items and delegate cards together", () => {
  const items: ConversationItem[] = [{
    type: "info",
    id: "snapshot-1",
    teamEventType: "team_runtime_snapshot",
    text: "Restored team state",
    ts: 1,
    snapshot: {
      teamId: "team-1",
      leadMemberId: "lead",
      policy: createDefaultTeamPolicy(),
      members: [{
        id: "lead",
        agent: "general",
        role: "lead",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      }, {
        id: "worker-1",
        agent: "code",
        role: "worker",
        status: "active",
        currentTaskId: "task-1",
        threadId: "thread-1",
        createdAt: 1,
        updatedAt: 1,
      }],
      tasks: [{
        id: "task-1",
        goal: "Review patch",
        status: "blocked",
        assigneeMemberId: "worker-1",
        dependencies: [],
        approvalId: "approval-1",
        createdAt: 1,
        updatedAt: 1,
      }],
      messages: [],
      approvals: [{
        id: "approval-1",
        taskId: "task-1",
        submittedByMemberId: "worker-1",
        status: "pending",
        plan: {
          goal: "Review patch",
          steps: [{ id: "step-1", title: "Inspect changes" }],
        },
        createdAt: 1,
        updatedAt: 1,
      }],
      shutdowns: [],
    },
  }, {
    type: "delegate",
    id: "delegate-1",
    agent: "code",
    task: "Review patch",
    childSessionId: "child-1",
    threadId: "thread-1",
    nickname: "Alpha",
    status: "error",
    error: "API timeout",
    ts: 2,
  }, {
    type: "info",
    id: "message-1",
    teamEventType: "team_message",
    text: "Team direct: worker-1 -> lead: Need clarification",
    kind: "direct",
    fromMemberId: "worker-1",
    toMemberId: "lead",
    relatedTaskId: "task-1",
    contentPreview: "Need clarification",
    ts: 3,
  }];

  const state = deriveTeamDashboardState(items);

  assertEquals(state.active, true);
  assertEquals(state.members.length, 2);
  assertEquals(state.taskBoard[0]?.status, "blocked");
  assertEquals(state.pendingApprovals[0]?.status, "pending");
  assertEquals(state.workers[0]?.nickname, "Alpha");
  assertEquals(state.attentionItems.some((item) => item.kind === "worker_failed"), true);
  assertEquals(state.attentionItems.some((item) => item.kind === "review_pending"), true);
  assertEquals(state.memberActivity["worker-1"]?.[0]?.summary, "Message to lead: Need clarification");
});

Deno.test("deriveTeamDashboardState maps worker-only activity into in-progress task counts", () => {
  const state = deriveTeamDashboardState([{
    type: "delegate",
    id: "delegate-1",
    agent: "code",
    task: "Investigate failure",
    threadId: "thread-1",
    nickname: "Alpha",
    status: "running",
    ts: 1,
  }]);

  assertEquals(state.taskCounts.in_progress, 1);
  assertEquals(state.taskCounts.running, 0);
});

Deno.test("deriveTeamDashboardState keeps teammate activity history from worker events", () => {
  const items: ConversationItem[] = [{
    type: "info",
    id: "activity-1",
    teamEventType: "team_member_activity",
    text: "Team worker worker-1: Tool TaskList: listed tasks",
    memberId: "worker-1",
    memberLabel: "worker-1",
    threadId: "thread-1",
    activityKind: "tool_end",
    status: "success",
    summary: "Tool TaskList: listed tasks",
    ts: 1,
  }];

  const state = deriveTeamDashboardState(items);
  const worker = state.members.find((member) => member.id === "worker-1");

  assertEquals(state.active, true);
  assertEquals(worker?.id, "worker-1");
  assertEquals(worker?.threadId, "thread-1");
  assertEquals(state.memberActivity["worker-1"]?.[0]?.summary, "Tool TaskList: listed tasks");
});

Deno.test("deriveTeamDashboardState keeps only the latest 6 activity items per member", () => {
  const items: ConversationItem[] = Array.from({ length: 7 }, (_, index) => ({
    type: "info",
    id: `activity-${index + 1}`,
    teamEventType: "team_member_activity",
    text: `activity ${index + 1}`,
    memberId: "worker-1",
    memberLabel: "worker-1",
    threadId: "thread-1",
    activityKind: "tool_end",
    status: "success",
    summary: `activity ${index + 1}`,
    ts: index + 1,
  }));

  const state = deriveTeamDashboardState(items);

  assertEquals(state.memberActivity["worker-1"]?.length, 6);
  assertEquals(
    state.memberActivity["worker-1"]?.map((entry) => entry.summary),
    [
      "activity 7",
      "activity 6",
      "activity 5",
      "activity 4",
      "activity 3",
      "activity 2",
    ],
  );
});

Deno.test("deriveTeamDashboardState keeps approval and shutdown attention visible for the rail", () => {
  const items: ConversationItem[] = [{
    type: "info",
    id: "snapshot-1",
    teamEventType: "team_runtime_snapshot",
    text: "Restored team state",
    ts: 1,
    snapshot: {
      teamId: "team-1",
      leadMemberId: "lead",
      policy: createDefaultTeamPolicy(),
      members: [{
        id: "lead",
        agent: "general",
        role: "lead",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      }],
      tasks: [],
      messages: [],
      approvals: [{
        id: "approval-1",
        taskId: "task-1",
        submittedByMemberId: "worker-1",
        status: "pending",
        plan: {
          goal: "Review patch",
          steps: [{ id: "step-1", title: "Inspect changes" }],
        },
        createdAt: 1,
        updatedAt: 1,
      }],
      shutdowns: [{
        id: "shutdown-1",
        memberId: "worker-1",
        requestedByMemberId: "lead",
        status: "requested",
        createdAt: 2,
        updatedAt: 2,
      }],
    },
  }];

  const state = deriveTeamDashboardState(items);

  assertEquals(state.pendingApprovals.length, 1);
  assertEquals(state.shutdowns[0]?.status, "requested");
  assertEquals(
    state.attentionItems.some((item) => item.kind === "shutdown_requested"),
    true,
  );
});
