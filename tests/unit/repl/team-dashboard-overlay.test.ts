import { assertEquals } from "jsr:@std/assert@1";
import {
  buildTeamDashboardDetailLines,
  buildTeamDashboardSummaryRows,
} from "../../../src/hlvm/cli/repl-ink/components/TeamDashboardOverlay.tsx";
import type { TeamDashboardState } from "../../../src/hlvm/cli/repl-ink/hooks/useTeamState.ts";

const EMPTY_TEAM_STATE: TeamDashboardState = {
  active: true,
  members: [],
  workers: [],
  memberActivity: {},
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

Deno.test("buildTeamDashboardDetailLines includes waiting state and recent member activity", () => {
  const lines = buildTeamDashboardDetailLines(
    {
      id: "member-worker-1",
      kind: "member",
      data: {
        id: "worker-1",
        role: "worker",
        status: "active",
        agent: "sonnet",
        threadId: "thread-1",
      },
    },
    {
      ...EMPTY_TEAM_STATE,
      members: [{
        id: "worker-1",
        role: "worker",
        status: "active",
        agent: "sonnet",
        threadId: "thread-1",
      }],
      memberActivity: {
        "worker-1": [{
          id: "activity-1",
          summary: "Tool TaskList: listed tasks",
          status: "success",
          activityKind: "tool_end",
          ts: 1,
          threadId: "thread-1",
        }],
      },
    },
    "question",
    "worker-1",
  );

  assertEquals(lines.includes("Waiting for your answer"), true);
  assertEquals(lines.includes("Recent activity:"), true);
  assertEquals(lines.includes("- Tool TaskList: listed tasks"), true);
});
