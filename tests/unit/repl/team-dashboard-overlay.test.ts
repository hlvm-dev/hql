import { assertEquals } from "jsr:@std/assert@1";
import { buildTeamDashboardSummaryRows } from "../../../src/hlvm/cli/repl-ink/components/TeamDashboardOverlay.tsx";
import type { TeamDashboardState } from "../../../src/hlvm/cli/repl-ink/hooks/useTeamState.ts";

const EMPTY_TEAM_STATE: TeamDashboardState = {
  active: true,
  members: [],
  workers: [],
  taskBoard: [],
  pendingApprovals: [],
  shutdowns: [],
  attentionItems: [],
  taskCounts: {
    backlog: 0,
    in_progress: 0,
    claimed: 0,
    completed: 0,
    errored: 0,
  },
  focusedWorkerIndex: -1,
};

Deno.test("buildTeamDashboardSummaryRows uses stable metric ordering", () => {
  const [primary, secondary] = buildTeamDashboardSummaryRows({
    ...EMPTY_TEAM_STATE,
    members: [{ id: "m1", role: "lead", status: "idle", agent: "opus" }],
    workers: [{
      id: "w1",
      nickname: "alpha",
      agent: "sonnet",
      status: "running",
      task: "Patch overlay",
      durationMs: 1200,
    }],
    pendingApprovals: [{
      id: "a1",
      taskId: "t1",
      taskGoal: "Review patch",
      submittedByMemberId: "m1",
      status: "pending",
    }],
    attentionItems: [{
      id: "att1",
      kind: "review_pending",
      label: "Approval pending",
      timestamp: 1,
    }],
    shutdowns: [{
      id: "s1",
      memberId: "m1",
      requestedByMemberId: "m2",
      status: "pending",
    }],
    taskCounts: {
      backlog: 0,
      in_progress: 1,
      claimed: 1,
      completed: 3,
      errored: 1,
    },
  }, 60);

  assertEquals(
    primary,
    "Members 1 · Workers 1                      Active 2 · Done 3",
  );
  assertEquals(
    secondary,
    "Reviews 1 · Attention 1               Shutdowns 1 · Errors 1",
  );
});
