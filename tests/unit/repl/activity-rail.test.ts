import { assertEquals } from "jsr:@std/assert@1";
import { buildActivityRailRows } from "../../../src/hlvm/cli/repl-ink/components/ActivityRail.tsx";
import type { TeamDashboardState } from "../../../src/hlvm/cli/repl-ink/hooks/useTeamState.ts";
import type { LocalAgentEntry } from "../../../src/hlvm/cli/repl-ink/utils/local-agents.ts";

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

function makeAgent(
  overrides: Partial<LocalAgentEntry> = {},
): LocalAgentEntry {
  return {
    id: "agent-1",
    kind: "delegate",
    name: "alpha",
    label: "Investigate",
    status: "running",
    statusLabel: "running",
    detail: "Reading files",
    interruptible: true,
    overlayTarget: "background-tasks",
    overlayItemId: "item-1",
    ...overrides,
  };
}

Deno.test("activity rail: returns null when there is no active state", () => {
  const model = buildActivityRailRows({
    localAgents: [],
    memberActivity: {},
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
    localAgents: [makeAgent()],
    memberActivity: {},
    teamState,
    width: 80,
  });

  assertEquals(model?.rows[0]?.text, "turn · continuing response");
  assertEquals(model?.rows[1]?.text, "agent · alpha · running · Reading files");
  assertEquals(model?.rows[2]?.text, "team · 1 plan review waiting");
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
    localAgents: [makeAgent(), makeAgent({ id: "agent-2", name: "beta" })],
    memberActivity: {},
    teamState,
    width: 80,
  });

  assertEquals(model?.rows.length, 3);
  assertEquals(model?.overflow, "+3 more");
});

Deno.test("activity rail: truncates rows to width and maps tones from agent status", () => {
  const model = buildActivityRailRows({
    localAgents: [makeAgent({
      status: "failed",
      statusLabel: "failed",
      detail: "A very long description that should be truncated to fit the available rail width.",
    })],
    memberActivity: {},
    teamState: emptyTeamState(),
    width: 24,
  });

  assertEquals(model?.rows[0]?.tone, "error");
  assertEquals((model?.rows[0]?.text.length ?? 0) <= 24, true);
});
