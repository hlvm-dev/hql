import { assertEquals } from "jsr:@std/assert@1";
import { buildActivityRailRows } from "../../../src/hlvm/cli/repl-ink/components/ActivityRail.tsx";
import type { TeamDashboardState } from "../../../src/hlvm/cli/repl-ink/hooks/useTeamState.ts";

function emptyTeamState(): TeamDashboardState {
  return {
    active: false,
    workers: [],
    members: [],
    memberActivity: {},
    taskBoard: [],
    pendingApprovals: [],
    shutdowns: [],
    taskCounts: {
      pending: 0,
      claimed: 0,
      in_progress: 0,
      blocked: 0,
      completed: 0,
      cancelled: 0,
      errored: 0,
      running: 0,
    },
    attentionItems: [],
    focusedWorkerIndex: -1,
  };
}

Deno.test("activity rail: returns null when there is no active state", () => {
  const model = buildActivityRailRows({
    teamState: emptyTeamState(),
    width: 80,
  });

  assertEquals(model, null);
});

Deno.test("activity rail: current turn state takes priority over agents and team attention", () => {
  const teamState = emptyTeamState();
  teamState.pendingApprovals = [{
    id: "approval-1",
    taskId: "task-1",
    submittedByMemberId: "worker-1",
    status: "pending",
  }];

  const model = buildActivityRailRows({
    currentTurn: { text: "continuing response", tone: "active" },
    teamState,
    width: 80,
  });

  assertEquals(model?.rows[0]?.text, "turn · continuing response");
  assertEquals(model?.rows[1]?.text, "team · 1 plan review waiting");
});

Deno.test("activity rail: limits to three rows and collapses overflow", () => {
  const teamState = emptyTeamState();
  teamState.pendingApprovals = [{
    id: "approval-1",
    taskId: "task-1",
    submittedByMemberId: "worker-1",
    status: "pending",
  }];
  teamState.shutdowns = [{
    id: "shutdown-1",
    memberId: "worker-1",
    requestedByMemberId: "lead",
    status: "requested",
  }];
  teamState.attentionItems = [{
    id: "attention-1",
    kind: "review_pending",
    label: "team · attention needed",
    timestamp: 1,
  }];

  const model = buildActivityRailRows({
    currentTurn: { text: "waiting for approval", tone: "warning" },
    teamState,
    width: 80,
  });

  assertEquals(model?.rows.length, 3);
  assertEquals(model?.overflow, "+1 more");
});

Deno.test("activity rail: truncates rows to width and preserves warning tone", () => {
  const teamState = emptyTeamState();
  teamState.pendingApprovals = [{
    id: "approval-1",
    taskId: "task-1",
    submittedByMemberId: "worker-1",
    status: "pending",
  }];

  const model = buildActivityRailRows({
    currentTurn: {
      text: "A very long description that should be truncated to fit the available rail width.",
      tone: "warning",
    },
    teamState,
    width: 24,
  });

  assertEquals(model?.rows[0]?.tone, "warning");
  assertEquals((model?.rows[0]?.text.length ?? 0) <= 24, true);
});
