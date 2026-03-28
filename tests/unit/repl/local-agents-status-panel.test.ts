import { assertEquals } from "jsr:@std/assert@1";
import {
  buildLocalAgentsStatusPanelModel,
  getLocalAgentsStatusPanelRowCount,
} from "../../../src/hlvm/cli/repl-ink/components/LocalAgentsStatusPanel.tsx";
import type { MemberActivityItem } from "../../../src/hlvm/cli/repl-ink/hooks/useTeamState.ts";
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
    interruptible: true,
    overlayTarget: "team-dashboard",
    overlayItemId: "member-worker-1",
    ...overrides,
  };
}

Deno.test("buildLocalAgentsStatusPanelModel uses live activity when available", () => {
  const model = buildLocalAgentsStatusPanelModel(
    [makeTeammate()],
    {
      "worker-1": [{
        id: "activity-1",
        summary: "Tool TaskList: listed tasks",
        status: "success",
        activityKind: "tool_end",
        ts: 1,
      } satisfies MemberActivityItem],
    },
    80,
  );

  assertEquals(model?.header.includes("1 local agent"), true);
  assertEquals(model?.header.includes("1 working"), true);
  assertEquals(model?.rows[0]?.summary.includes("Find unused code in agent/"), true);
  assertEquals(model?.rows[0]?.detail, "Tool TaskList: listed tasks");
});

Deno.test("buildLocalAgentsStatusPanelModel falls back to background status messaging", () => {
  const model = buildLocalAgentsStatusPanelModel(
    [
      makeTeammate({ name: "alpha" }),
      makeTeammate({
        id: "teammate:worker-2",
        memberId: "worker-2",
        name: "beta",
        label: "Find unused code in cli/",
      }),
    ],
    {},
    100,
  );

  assertEquals(model?.header, "• 2 local agents · 2 working · Ctrl+T manager");
  assertEquals(
    model?.rows[0]?.detail,
    "Running in the background (Ctrl+T manager)",
  );
});

Deno.test("buildLocalAgentsStatusPanelModel surfaces waiting and completed states", () => {
  const model = buildLocalAgentsStatusPanelModel(
    [
      makeTeammate({
        status: "waiting",
        statusLabel: "awaiting approval",
        detail: "Waiting for your approval",
      }),
      makeTeammate({
        id: "teammate:worker-2",
        memberId: "worker-2",
        name: "worker-2",
        label: "Inspect CLI",
        status: "completed",
        statusLabel: "done",
        detail: "Task completed: Inspect CLI",
      }),
    ],
    {},
    96,
  );

  assertEquals(model?.header, "• 2 local agents · 1 waiting · 1 done · Ctrl+T manager");
  assertEquals(model?.rows[0]?.detail, "Waiting for your approval");
  assertEquals(model?.rows[1]?.detail, "Task completed: Inspect CLI");
});

Deno.test("getLocalAgentsStatusPanelRowCount caps visible agents and adds overflow row", () => {
  assertEquals(getLocalAgentsStatusPanelRowCount(0), 0);
  assertEquals(getLocalAgentsStatusPanelRowCount(1), 3);
  assertEquals(getLocalAgentsStatusPanelRowCount(4), 9);
  assertEquals(getLocalAgentsStatusPanelRowCount(6), 10);
});
