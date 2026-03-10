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
