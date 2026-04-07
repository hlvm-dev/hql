import { assertEquals } from "jsr:@std/assert@1";
import {
  buildBackgroundStatusFooterModel,
  buildLocalAgentsCompactFooterModel,
  buildLocalAgentsManagerModel,
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
    detail: "Inspecting agent graph",
    interruptible: true,
    overlayTarget: "background-tasks",
    overlayItemId: "teammate:worker-1",
    progress: {
      activityText: "Inspecting agent graph",
      previewLines: [
        "Inspecting agent graph",
        "Read src/hlvm/agent/session.ts",
      ],
      toolUseCount: 2,
      tokenCount: 1420,
      durationMs: 4200,
    },
    ...overrides,
  };
}

Deno.test("buildLocalAgentsCompactFooterModel keeps the default shell to one compact row", () => {
  const model = buildLocalAgentsCompactFooterModel(
    [makeTeammate()],
    100,
    {
      leader: {
        idleText: "Idle · 1 working",
      },
    },
  );

  assertEquals(model?.rowCount, 1);
  assertEquals(model?.highlighted, false);
  assertEquals(model?.hintText, " · Ctrl+T manager");
  assertEquals(model?.text, "team-lead · Idle · 1 working · Inspecting agent graph");
});

Deno.test("buildBackgroundStatusFooterModel shows a single background-task summary row when no local agents are active", () => {
  const model = buildBackgroundStatusFooterModel([], 100, {
    activeTaskCount: 2,
    recentActiveTaskLabel: "(+ 1 2)",
  });

  assertEquals(model?.rowCount, 1);
  assertEquals(model?.hintText, " · Ctrl+T manager");
  assertEquals(model?.text, "tasks · 2 tasks running · (+ 1 2)");
});

Deno.test("buildLocalAgentsCompactFooterModel shows focused manager hint without expanding previews", () => {
  const model = buildLocalAgentsCompactFooterModel(
    [makeTeammate()],
    100,
    {
      focused: true,
      leader: {
        activityText: "Continuing response",
      },
    },
  );

  assertEquals(model?.highlighted, true);
  assertEquals(model?.hintText, " · Enter view · Esc back");
  assertEquals(model?.text, "team-lead · Continuing response · Inspecting agent graph");
});

Deno.test("buildLocalAgentsManagerModel keeps preview rows for manager-only mode", () => {
  const model = buildLocalAgentsManagerModel(
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
  assertEquals(model?.leader.hintText, " · enter to view · esc back");
  assertEquals(model?.agents[0]?.previewLines, [
    "Inspecting agent graph",
    "Read src/hlvm/agent/session.ts",
  ]);
});

Deno.test("buildLocalAgentsManagerModel keeps inline metrics, tones, and overflow rows", () => {
  const model = buildLocalAgentsManagerModel(
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
        detail: "Finished inspecting CLI",
        progress: {
          activityText: "Finished inspecting CLI",
          previewLines: ["Final answer ready"],
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
  assertEquals(model?.agents[0]?.metricsText, undefined);
  assertEquals(model?.overflow, "└─ 1 more agents · Ctrl+T manager");
});
