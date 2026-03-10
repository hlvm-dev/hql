import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import { createTeamRuntime } from "../../../src/hlvm/agent/team-runtime.ts";

Deno.test("team runtime: dependencies block claim until prerequisites complete", () => {
  const runtime = createTeamRuntime("lead", "lead");
  runtime.registerMember({ id: "worker-1", agent: "code" });
  runtime.ensureTask({
    id: "task-a",
    goal: "Prepare patch",
    status: "pending",
  });
  runtime.ensureTask({
    id: "task-b",
    goal: "Review patch",
    status: "pending",
    dependencies: ["task-a"],
  });

  assertEquals(runtime.getTask("task-b")?.status, "blocked");
  assertEquals(runtime.getBlockingDependencies("task-b").map((task) => task.taskId), [
    "task-a",
  ]);

  const blockedClaim = runtime.claimTask("task-b", "worker-1");
  assertEquals(blockedClaim?.status, "blocked");

  runtime.updateTask("task-a", { status: "completed" });

  assertEquals(runtime.getTask("task-b")?.status, "pending");
  const claimed = runtime.claimTask("task-b", "worker-1");
  assertEquals(claimed?.status, "claimed");
  assertEquals(claimed?.assigneeMemberId, "worker-1");
});

Deno.test("team runtime: claimTask does not steal claimed or in-progress work", () => {
  const runtime = createTeamRuntime("lead", "lead");
  runtime.registerMember({ id: "worker-1", agent: "code" });
  runtime.registerMember({ id: "worker-2", agent: "review" });
  runtime.ensureTask({
    id: "task-1",
    goal: "Implement guarded claim",
    status: "pending",
  });

  const firstClaim = runtime.claimTask("task-1", "worker-1");
  assertEquals(firstClaim?.status, "claimed");
  assertEquals(firstClaim?.assigneeMemberId, "worker-1");

  const stolenClaim = runtime.claimTask("task-1", "worker-2");
  assertEquals(stolenClaim?.status, "claimed");
  assertEquals(stolenClaim?.assigneeMemberId, "worker-1");

  runtime.updateTask("task-1", { status: "in_progress" });
  const inProgressClaim = runtime.claimTask("task-1", "worker-2");
  assertEquals(inProgressClaim?.status, "in_progress");
  assertEquals(inProgressClaim?.assigneeMemberId, "worker-1");

  const idempotentClaim = runtime.claimTask("task-1", "worker-1");
  assertEquals(idempotentClaim?.status, "in_progress");
  assertEquals(idempotentClaim?.assigneeMemberId, "worker-1");
});

Deno.test("team runtime: snapshot restores members, tasks, messages, approvals, and shutdowns", () => {
  const runtime = createTeamRuntime("lead", "lead");
  runtime.registerMember({ id: "worker-1", agent: "code", currentTaskId: "task-1" });
  runtime.ensureTask({
    id: "task-1",
    goal: "Review patch",
    status: "in_progress",
    assigneeMemberId: "worker-1",
  });
  runtime.sendMessage({
    fromMemberId: "worker-1",
    toMemberId: "lead",
    content: "Need clarification",
  });
  runtime.requestPlanApproval({
    taskId: "task-1",
    submittedByMemberId: "worker-1",
    plan: {
      goal: "Review patch",
      steps: [{ id: "step-1", title: "Inspect diff" }],
    },
  });
  runtime.requestShutdown({
    memberId: "worker-1",
    requestedByMemberId: "lead",
    reason: "Task complete",
  });

  const snapshot = runtime.snapshot();
  const restored = createTeamRuntime("lead", "lead", { snapshot });

  assertEquals(restored.listMembers().length, 2);
  assertEquals(restored.listTasks().length, 1);
  const restoredMessage = restored.readMessages("lead")[0];
  assertExists(restoredMessage);
  assertEquals(restoredMessage.content, "Need clarification");
  assertEquals(restoredMessage.fromMemberId, "worker-1");
  assertEquals(restored.listApprovals().length, 1);
  assertEquals(restored.listShutdowns().length, 1);
  assertEquals(restored.deriveSummary().memberCount, 2);
  assertEquals(restored.getMember("worker-1")?.currentTaskId, "task-1");
  assertEquals(restored.getTask("task-1")?.status, "blocked");
  assertEquals(restored.getTask("task-1")?.assigneeMemberId, "worker-1");
  assertEquals(restored.listApprovals()[0]?.taskId, "task-1");
  assertEquals(restored.listShutdowns()[0]?.reason, "Task complete");
});

Deno.test("team runtime: overdue shutdowns escalate and terminate the member task", () => {
  const runtime = createTeamRuntime("lead", "lead");
  runtime.registerMember({ id: "worker-1", agent: "code", currentTaskId: "task-1" });
  runtime.ensureTask({
    id: "task-1",
    goal: "Long running task",
    status: "in_progress",
    assigneeMemberId: "worker-1",
  });
  const request = runtime.requestShutdown({
    memberId: "worker-1",
    requestedByMemberId: "lead",
    reason: "Timed out",
  });

  const forced = runtime.forceExpiredShutdowns(
    "lead",
    (request?.escalateAt ?? Date.now()) + 1,
  );

  assertEquals(forced.length, 1);
  assertEquals(forced[0]?.status, "forced");
  assertEquals(runtime.getMember("worker-1")?.status, "terminated");
  assertEquals(runtime.getTask("task-1")?.status, "cancelled");
});

Deno.test("team runtime: broadcast messages are delivered once per teammate", () => {
  const runtime = createTeamRuntime("lead", "lead");
  runtime.registerMember({ id: "worker-1", agent: "code" });
  runtime.registerMember({ id: "worker-2", agent: "web" });

  const sent = runtime.sendMessage({
    fromMemberId: "lead",
    kind: "broadcast",
    content: "Everyone switch to review mode",
  });

  assertEquals(sent.length, 2);
  assertEquals(runtime.readMessages("worker-1").length, 1);
  assertEquals(runtime.readMessages("worker-2").length, 1);
});

Deno.test("team runtime: resolving plan approval unblocks the task", () => {
  const runtime = createTeamRuntime("lead", "lead");
  runtime.registerMember({ id: "worker-1", agent: "code" });
  runtime.ensureTask({
    id: "task-1",
    goal: "Propose a plan",
    status: "pending",
    assigneeMemberId: "worker-1",
  });

  const approval = runtime.requestPlanApproval({
    taskId: "task-1",
    submittedByMemberId: "worker-1",
    plan: {
      goal: "Propose a plan",
      steps: [{ id: "step-1", title: "Inspect the workspace" }],
    },
  });

  assertEquals(runtime.getTask("task-1")?.status, "blocked");
  const reviewed = runtime.reviewPlan({
    approvalId: approval.id,
    reviewedByMemberId: "lead",
    approved: false,
    feedback: "Try a safer approach",
  });

  assertExists(reviewed);
  assertEquals(reviewed.status, "rejected");
  assertEquals(runtime.getTask("task-1")?.status, "pending");
});

Deno.test("team runtime: requestPlanApproval rejects unknown tasks", () => {
  const runtime = createTeamRuntime("lead", "lead");

  assertThrows(
    () =>
      runtime.requestPlanApproval({
        taskId: "missing-task",
        submittedByMemberId: "lead",
        plan: {
          goal: "Missing task",
          steps: [{ id: "step-1", title: "Impossible" }],
        },
      }),
    Error,
    "task 'missing-task' not found",
  );
});

Deno.test("team runtime: repeated plan approval and shutdown requests are idempotent", () => {
  const runtime = createTeamRuntime("lead", "lead");
  runtime.registerMember({ id: "worker-1", agent: "code" });
  runtime.ensureTask({
    id: "task-1",
    goal: "Implement change",
    status: "pending",
    assigneeMemberId: "worker-1",
  });

  const firstApproval = runtime.requestPlanApproval({
    taskId: "task-1",
    submittedByMemberId: "worker-1",
    note: "v1",
    plan: {
      goal: "Implement change",
      steps: [{ id: "step-1", title: "Inspect code" }],
    },
  });
  const secondApproval = runtime.requestPlanApproval({
    taskId: "task-1",
    submittedByMemberId: "worker-1",
    note: "v2",
    plan: {
      goal: "Implement change",
      steps: [{ id: "step-2", title: "Apply patch" }],
    },
  });
  assertEquals(secondApproval.id, firstApproval.id);
  assertEquals(runtime.listPendingApprovals().length, 1);
  assertEquals(runtime.listPendingApprovals()[0]?.note, "v2");

  const firstShutdown = runtime.requestShutdown({
    memberId: "worker-1",
    requestedByMemberId: "lead",
    reason: "done",
  });
  const secondShutdown = runtime.requestShutdown({
    memberId: "worker-1",
    requestedByMemberId: "lead",
    reason: "really done",
  });
  assertEquals(secondShutdown?.id, firstShutdown?.id);
  assertEquals(runtime.listShutdowns().length, 1);
  assertEquals(runtime.getPendingShutdown("worker-1")?.reason, "really done");
});

Deno.test("team runtime: deriveSummary reports unread messages for the requested viewer", () => {
  const runtime = createTeamRuntime("lead", "lead");
  runtime.registerMember({ id: "worker-1", agent: "code" });

  runtime.sendMessage({
    fromMemberId: "lead",
    toMemberId: "worker-1",
    content: "please review",
  });

  assertEquals(runtime.deriveSummary("worker-1").unreadMessages, 1);
  assertEquals(runtime.deriveSummary("lead").unreadMessages, 0);
});

Deno.test("team runtime: task assignment is the SSOT for member currentTaskId", () => {
  const runtime = createTeamRuntime("lead", "lead");
  runtime.registerMember({ id: "worker-1", agent: "code" });
  runtime.registerMember({ id: "worker-2", agent: "review" });
  runtime.ensureTask({
    id: "task-1",
    goal: "Implement patch",
    status: "pending",
  });

  runtime.claimTask("task-1", "worker-1");
  assertEquals(runtime.getMember("worker-1")?.currentTaskId, "task-1");

  runtime.updateTask("task-1", { assigneeMemberId: "worker-2" });
  assertEquals(runtime.getMember("worker-1")?.currentTaskId, undefined);
  assertEquals(runtime.getMember("worker-2")?.currentTaskId, "task-1");

  runtime.updateTask("task-1", { status: "completed" });
  assertEquals(runtime.getMember("worker-2")?.currentTaskId, undefined);
});

Deno.test("team runtime: onChange summary uses the lead viewer semantics", () => {
  let latestUnread = -1;
  const runtime = createTeamRuntime("lead", "lead", {
    onChange: (_snapshot, summary) => {
      latestUnread = summary.unreadMessages;
    },
  });
  runtime.registerMember({ id: "worker-1", agent: "code" });

  runtime.sendMessage({
    fromMemberId: "lead",
    toMemberId: "worker-1",
    content: "private follow-up",
  });

  assertEquals(latestUnread, 0);
});

Deno.test("team runtime: rejects invalid members and cross-links in the runtime SSOT", () => {
  const runtime = createTeamRuntime("lead", "lead");
  runtime.registerMember({ id: "worker-1", agent: "code" });
  runtime.ensureTask({
    id: "task-1",
    goal: "Review patch",
    status: "pending",
    assigneeMemberId: "worker-1",
  });

  assertThrows(
    () =>
      runtime.updateTask("task-1", {
        assigneeMemberId: "missing-worker",
      }),
    Error,
    "member 'missing-worker' not found",
  );
  assertThrows(
    () =>
      runtime.sendMessage({
        fromMemberId: "missing-worker",
        toMemberId: "worker-1",
        content: "hello",
      }),
    Error,
    "member 'missing-worker' not found",
  );
  assertThrows(
    () =>
      runtime.sendMessage({
        fromMemberId: "worker-1",
        toMemberId: "lead",
        content: "about a task",
        relatedTaskId: "missing-task",
      }),
    Error,
    "task 'missing-task' not found",
  );
});

Deno.test("team runtime: only the lead can review plans and request shutdown", () => {
  const runtime = createTeamRuntime("lead", "lead");
  runtime.registerMember({ id: "worker-1", agent: "code" });
  runtime.ensureTask({
    id: "task-1",
    goal: "Implement change",
    status: "pending",
    assigneeMemberId: "worker-1",
  });

  const approval = runtime.requestPlanApproval({
    taskId: "task-1",
    submittedByMemberId: "worker-1",
    plan: {
      goal: "Implement change",
      steps: [{ id: "step-1", title: "Edit the parser" }],
    },
  });

  assertThrows(
    () =>
      runtime.reviewPlan({
        approvalId: approval.id,
        reviewedByMemberId: "worker-1",
        approved: true,
      }),
    Error,
    "only the lead can review team plans",
  );
  assertThrows(
    () =>
      runtime.requestShutdown({
        memberId: "worker-1",
        requestedByMemberId: "worker-1",
      }),
    Error,
    "only the lead can request teammate shutdown",
  );
});

Deno.test("team runtime: reconcileStaleWorkers terminates members and cancels their tasks", () => {
  // Build a snapshot that simulates a crashed previous process with active workers
  const original = createTeamRuntime("lead", "lead");
  original.registerMember({ id: "worker-1", agent: "code" });
  original.registerMember({ id: "worker-2", agent: "web" });
  original.ensureTask({
    id: "task-1",
    goal: "Implement feature A",
    status: "in_progress",
    assigneeMemberId: "worker-1",
  });
  original.ensureTask({
    id: "task-2",
    goal: "Research topic B",
    status: "claimed",
    assigneeMemberId: "worker-2",
  });
  original.ensureTask({
    id: "task-3",
    goal: "Already done",
    status: "completed",
    assigneeMemberId: "worker-1",
  });
  const snapshot = original.snapshot();

  // Restore with reconcileStaleWorkers — simulates new process
  const restored = createTeamRuntime("lead", "lead", {
    snapshot,
    reconcileStaleWorkers: true,
  });

  // Workers should be terminated
  assertEquals(restored.getMember("worker-1")?.status, "terminated");
  assertEquals(restored.getMember("worker-2")?.status, "terminated");
  assertEquals(restored.getMember("lead")?.status, "active");

  // In-flight tasks should be cancelled, completed task untouched
  assertEquals(restored.getTask("task-1")?.status, "cancelled");
  assertEquals(restored.getTask("task-2")?.status, "cancelled");
  assertEquals(restored.getTask("task-3")?.status, "completed");

  // Cancelled tasks should have assignee cleared
  assertEquals(restored.getTask("task-1")?.assigneeMemberId, undefined);
  assertEquals(restored.getTask("task-2")?.assigneeMemberId, undefined);
});
