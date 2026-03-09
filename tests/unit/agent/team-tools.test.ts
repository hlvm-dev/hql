import { assertEquals } from "jsr:@std/assert";
import { createTeamRuntime } from "../../../src/hlvm/agent/team-runtime.ts";
import { TEAM_TOOLS } from "../../../src/hlvm/agent/tools/team-tools.ts";

Deno.test("team tools: team_status_read returns summary, policy, approvals, and unread messages", async () => {
  const runtime = createTeamRuntime("lead", "lead");
  runtime.registerMember({ id: "worker-1", agent: "code", currentTaskId: "task-1" });
  runtime.ensureTask({
    id: "task-1",
    goal: "Implement parser change",
    status: "in_progress",
    assigneeMemberId: "worker-1",
  });
  runtime.requestPlanApproval({
    taskId: "task-1",
    submittedByMemberId: "worker-1",
    plan: {
      goal: "Implement parser change",
      steps: [{ id: "step-1", title: "Inspect parser" }],
    },
    note: "Need review before editing",
  });
  runtime.sendMessage({
    fromMemberId: "worker-1",
    toMemberId: "lead",
    content: "Please check the task",
  });

  const result = await TEAM_TOOLS.team_status_read.fn(
    {},
    "",
    {
      teamRuntime: runtime,
      teamMemberId: "lead",
      teamLeadMemberId: "lead",
    },
  ) as {
    summary: {
      pendingApprovals: number;
      policy: { reviewProfile: string };
    };
    current_member: { id: string };
    pending_approvals: Array<{ taskId: string }>;
    unread_messages: Array<{ content: string }>;
  };

  assertEquals(result.summary.pendingApprovals, 1);
  assertEquals(result.summary.policy.reviewProfile, "code");
  assertEquals(result.current_member.id, "lead");
  assertEquals(result.pending_approvals[0]?.taskId, "task-1");
  assertEquals(result.unread_messages[0]?.content, "Please check the task");
});
