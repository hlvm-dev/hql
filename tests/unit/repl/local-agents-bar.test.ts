import { assertEquals } from "jsr:@std/assert@1";
import {
  buildLocalAgentsBarLine,
  shouldRenderLocalAgentsBar,
} from "../../../src/hlvm/cli/repl-ink/components/LocalAgentsBar.tsx";
import { buildLocalAgentEntries } from "../../../src/hlvm/cli/repl-ink/utils/local-agents.ts";
import type {
  MemberActivityItem,
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
  assertEquals(line?.hints.includes("↓ manage"), true);
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

Deno.test("shouldRenderLocalAgentsBar hides unfocused rail when footer already shows the team summary", () => {
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
    false,
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
