import { assertEquals } from "jsr:@std/assert@1";
import {
  buildLocalAgentsStatusPanelModel,
} from "../../../src/hlvm/cli/repl-ink/components/LocalAgentsStatusPanel.tsx";
import type { LocalAgentEntry } from "../../../src/hlvm/cli/repl-ink/utils/local-agents.ts";

function makeTeammate(overrides: Partial<LocalAgentEntry> = {}): LocalAgentEntry {
  return {
    id: "teammate:worker-1",
    kind: "teammate",
    name: "worker-1",
    memberId: "worker-1",
    label: "Find unused code in agent/",
    status: "running",
    statusLabel: "running",
    detail: "Tool TaskList: listed tasks",
    interruptible: true,
    overlayTarget: "team-dashboard",
    overlayItemId: "member-worker-1",
    progress: {
      activityText: "Tool TaskList: listed tasks",
      previewLines: [
        "Planning: inspect agent graph",
        "Tool read_file: src/hlvm/agent/session.ts",
      ],
      toolUseCount: 2,
      tokenCount: 1420,
      durationMs: 4200,
    },
    ...overrides,
  };
}

Deno.test("buildLocalAgentsStatusPanelModel renders a leader row with focused hint text", () => {
  const model = buildLocalAgentsStatusPanelModel(
    [makeTeammate()],
    100,
    {
      focused: true,
      leader: {
        activityText: "continuing response",
      },
    },
  );

  assertEquals(model?.leader.name, "team-lead");
  assertEquals(model?.leader.treePrefix, "╒═");
  assertEquals(model?.leader.bodyText, "continuing response");
  assertEquals(model?.leader.hintText, " · enter to view · esc back");
  assertEquals(model?.agents[0]?.previewLines.length, 2);
});

Deno.test("buildLocalAgentsStatusPanelModel keeps inline metrics and hides preview rows until focused", () => {
  const model = buildLocalAgentsStatusPanelModel(
    [makeTeammate()],
    100,
    {
      leader: {
        idleText: "Idle · 1 working",
      },
    },
  );

  assertEquals(model?.leader.bodyText, "Idle · 1 working");
  assertEquals(model?.agents[0]?.treePrefix, "└─");
  assertEquals(model?.agents[0]?.previewLines.length, 0);
  assertEquals(model?.agents[0]?.metricsText, " · 2 tool uses · 1,420 tokens · 4.2s");
  assertEquals(model?.rowCount, 2);
});

Deno.test("buildLocalAgentsStatusPanelModel keeps waiting/completed tones and overflow row", () => {
  const model = buildLocalAgentsStatusPanelModel(
    [
      makeTeammate({
        status: "waiting",
        statusLabel: "awaiting approval",
        detail: "Waiting for your approval",
        progress: {
          activityText: "Waiting for your approval",
          previewLines: [],
        },
      }),
      makeTeammate({
        id: "teammate:worker-2",
        memberId: "worker-2",
        name: "worker-2",
        label: "Inspect CLI",
        status: "completed",
        statusLabel: "done",
        detail: "Task completed: Inspect CLI",
        progress: {
          activityText: "Task completed: Inspect CLI",
          previewLines: ["Final: cleaned up cli/repl"],
          durationMs: 3100,
        },
      }),
      makeTeammate({ id: "teammate:worker-3", memberId: "worker-3", name: "worker-3" }),
      makeTeammate({ id: "teammate:worker-4", memberId: "worker-4", name: "worker-4" }),
      makeTeammate({ id: "teammate:worker-5", memberId: "worker-5", name: "worker-5" }),
    ],
    120,
    {
      leader: {
        idleText: "Idle · 5 working",
      },
    },
  );

  assertEquals(model?.agents[0]?.tone, "warning");
  assertEquals(model?.agents[1]?.tone, "success");
  assertEquals(model?.overflow, "└─ 1 more agents · Ctrl+T manager");
});
