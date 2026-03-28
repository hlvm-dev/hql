import { assertEquals } from "jsr:@std/assert@1";
import {
  buildLocalAgentsBarLine,
  shouldRenderLocalAgentsBar,
} from "../../../src/hlvm/cli/repl-ink/components/LocalAgentsBar.tsx";
import { buildLocalAgentEntries } from "../../../src/hlvm/cli/repl-ink/utils/local-agents.ts";
import type {
  MemberActivityItem,
  PendingApprovalItem,
  TaskBoardItem,
  TeamMemberItem,
} from "../../../src/hlvm/cli/repl-ink/hooks/useTeamState.ts";
import type {
  DelegateTask,
  Task,
} from "../../../src/hlvm/cli/repl/task-manager/index.ts";

function makeWorker(overrides: Partial<TeamMemberItem> = {}): TeamMemberItem {
  return {
    id: "worker-1",
    agent: "general",
    role: "worker",
    status: "active",
    threadId: "thread-1",
    currentTaskId: "task-1",
    currentTaskGoal: "Inspect CLI",
    ...overrides,
  };
}

function makeActivity(
  overrides: Partial<MemberActivityItem> = {},
): MemberActivityItem {
  return {
    id: "activity-1",
    summary: "Tool TaskList: listed tasks",
    status: "active",
    activityKind: "tool_end",
    ts: 1,
    threadId: "thread-1",
    ...overrides,
  };
}

function makeDelegateTask(overrides: Partial<DelegateTask> = {}): DelegateTask {
  return {
    id: "delegate-1",
    type: "delegate",
    label: "alpha [Explore]: inspect overlay",
    status: "running",
    createdAt: 1,
    startedAt: 2,
    agent: "Explore",
    task: "Inspect overlay",
    nickname: "alpha",
    threadId: "thread-delegate",
    ...overrides,
  };
}

Deno.test("buildLocalAgentEntries includes live teammates and delegates", () => {
  const members: TeamMemberItem[] = [makeWorker()];
  const memberActivity: Record<string, MemberActivityItem[]> = {
    "worker-1": [makeActivity()],
  };
  const tasks: Task[] = [makeDelegateTask()];

  const entries = buildLocalAgentEntries(members, memberActivity, tasks);

  assertEquals(entries.map((entry) => entry.kind), ["teammate", "delegate"]);
  assertEquals(entries[0]?.status, "running");
  assertEquals(entries[0]?.overlayTarget, "team-dashboard");
  assertEquals(entries[0]?.name, "worker-1");
  assertEquals(entries[1]?.status, "running");
  assertEquals(entries[1]?.overlayTarget, "background-tasks");
  assertEquals(entries[1]?.name, "alpha");
});

Deno.test("buildLocalAgentEntries falls back to idle teammate when no active work exists", () => {
  const members: TeamMemberItem[] = [
    makeWorker({
      currentTaskId: undefined,
      currentTaskGoal: undefined,
      status: "active",
      threadId: "thread-1",
    }),
  ];

  const entries = buildLocalAgentEntries(members, {}, []);

  assertEquals(entries.length, 1);
  assertEquals(entries[0]?.status, "idle");
  assertEquals(entries[0]?.label, "worker-1");
  assertEquals(entries[0]?.interruptible, false);
});

Deno.test("buildLocalAgentEntries keeps terminated teammates visible with terminal status", () => {
  const members: TeamMemberItem[] = [
    makeWorker({
      currentTaskId: undefined,
      currentTaskGoal: undefined,
      status: "terminated",
      threadId: "thread-1",
    }),
  ];
  const memberActivity: Record<string, MemberActivityItem[]> = {
    "worker-1": [makeActivity({
      summary: "Task completed: Inspect CLI",
      status: "success",
    })],
  };
  const taskBoard: TaskBoardItem[] = [{
    id: "task-1",
    goal: "Inspect CLI",
    status: "completed",
    assignee: "worker-1",
    blockedBy: [],
  }];

  const entries = buildLocalAgentEntries(members, memberActivity, [], {
    taskBoard,
  });

  assertEquals(entries.length, 1);
  assertEquals(entries[0]?.status, "completed");
  assertEquals(entries[0]?.statusLabel, "done");
  assertEquals(entries[0]?.detail, "Task completed: Inspect CLI");
});

Deno.test("buildLocalAgentEntries marks teammates waiting on approval", () => {
  const members: TeamMemberItem[] = [makeWorker()];
  const pendingApprovals: PendingApprovalItem[] = [{
    id: "approval-1",
    taskId: "task-1",
    taskGoal: "Inspect CLI",
    submittedByMemberId: "worker-1",
    status: "pending",
  }];

  const entries = buildLocalAgentEntries(members, {}, [], {
    pendingApprovals,
  });

  assertEquals(entries[0]?.status, "waiting");
  assertEquals(entries[0]?.statusLabel, "awaiting approval");
  assertEquals(entries[0]?.detail, "Plan review pending: Inspect CLI");
});

Deno.test("buildLocalAgentEntries marks blocked teammates explicitly", () => {
  const members: TeamMemberItem[] = [makeWorker()];
  const taskBoard: TaskBoardItem[] = [{
    id: "task-1",
    goal: "Inspect CLI",
    status: "blocked",
    assignee: "worker-1",
    blockedBy: ["task-0"],
  }];

  const entries = buildLocalAgentEntries(members, {}, [], {
    taskBoard,
  });

  assertEquals(entries[0]?.status, "blocked");
  assertEquals(entries[0]?.detail, "Blocked by #task-0");
});

Deno.test("buildLocalAgentEntries includes completed delegate tasks so outcomes stay visible", () => {
  const entries = buildLocalAgentEntries([], {}, [
    makeDelegateTask({
      status: "completed",
      summary: "Found unused exports in cli/",
    }),
  ]);

  assertEquals(entries.length, 1);
  assertEquals(entries[0]?.status, "completed");
  assertEquals(entries[0]?.detail, "Found unused exports in cli/");
});

Deno.test("buildLocalAgentsBarLine shows summary state when unfocused", () => {
  const line = buildLocalAgentsBarLine(
    [
      {
        id: "delegate:1",
        kind: "delegate",
        name: "alpha",
        label: "Inspect overlay",
        status: "running",
        statusLabel: "running",
        interruptible: true,
        overlayTarget: "background-tasks",
        overlayItemId: "bg:delegate-1",
      },
      {
        id: "teammate:worker-1",
        kind: "teammate",
        name: "worker-1",
        label: "Inspect CLI",
        status: "running",
        statusLabel: "running",
        interruptible: true,
        overlayTarget: "team-dashboard",
        overlayItemId: "member-worker-1",
      },
    ],
    false,
    80,
  );

  assertEquals(line?.summary, "2 local agents");
  assertEquals(line?.hints, "2 working · ↓ manage · Ctrl+T manager");
});

Deno.test("buildLocalAgentsBarLine shows focused agent controls", () => {
  const line = buildLocalAgentsBarLine(
    [
      {
        id: "delegate:1",
        kind: "delegate",
        name: "alpha",
        label: "Inspect overlay session progress",
        status: "running",
        statusLabel: "running",
        interruptible: true,
        overlayTarget: "background-tasks",
        overlayItemId: "bg:delegate-1",
      },
    ],
    true,
    96,
  );

  assertEquals(line?.summary, "alpha (running)");
  assertEquals(line?.hints.includes("Enter open"), true);
});

Deno.test("shouldRenderLocalAgentsBar keeps the rail visible when agents exist", () => {
  assertEquals(
    shouldRenderLocalAgentsBar(
      [
        {
          id: "teammate:worker-1",
          kind: "teammate",
          name: "worker-1",
          label: "Inspect CLI",
          status: "running",
          statusLabel: "running",
          interruptible: true,
          overlayTarget: "team-dashboard",
          overlayItemId: "member-worker-1",
        },
      ],
      false,
      "3 working",
    ),
    true,
  );
});

Deno.test("shouldRenderLocalAgentsBar keeps focused rail visible even when footer already shows the team summary", () => {
  assertEquals(
    shouldRenderLocalAgentsBar(
      [
        {
          id: "teammate:worker-1",
          kind: "teammate",
          name: "worker-1",
          label: "Inspect CLI",
          status: "running",
          statusLabel: "running",
          interruptible: true,
          overlayTarget: "team-dashboard",
          overlayItemId: "member-worker-1",
        },
      ],
      true,
      "3 working",
    ),
    true,
  );
});
