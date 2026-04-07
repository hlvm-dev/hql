import { assertEquals } from "jsr:@std/assert@1";
import {
  buildBackgroundTasksSummaryRows,
  formatBackgroundTaskResultLine,
  type UnifiedTaskItem,
} from "../../../src/hlvm/cli/repl-ink/components/BackgroundTasksOverlay.tsx";

const MUTED_COLOR: [number, number, number] = [128, 128, 128];
const WARN_COLOR: [number, number, number] = [255, 200, 0];
const OK_COLOR: [number, number, number] = [0, 200, 0];
const ERR_COLOR: [number, number, number] = [200, 0, 0];

function makeTeamItem(overrides: Partial<UnifiedTaskItem> = {}): UnifiedTaskItem {
  return {
    id: "team:1",
    kind: "team",
    label: "#1 Fix authentication bug",
    status: "pending",
    statusText: "pending",
    icon: "○",
    iconColor: MUTED_COLOR,
    blocked: false,
    ...overrides,
  };
}

function makeEvalItem(overrides: Partial<UnifiedTaskItem> = {}): UnifiedTaskItem {
  return {
    id: "bg:eval-1",
    kind: "eval",
    label: "(+ 1 2)",
    status: "running",
    statusText: "running",
    icon: "●",
    iconColor: WARN_COLOR,
    blocked: false,
    ...overrides,
  };
}

function makeDelegateItem(overrides: Partial<UnifiedTaskItem> = {}): UnifiedTaskItem {
  return {
    id: "bg:delegate-1",
    kind: "delegate",
    label: "Inspect overlay layout",
    status: "completed",
    statusText: "done",
    icon: "✓",
    iconColor: OK_COLOR,
    blocked: false,
    ...overrides,
  };
}

Deno.test("buildBackgroundTasksSummaryRows shows unified task metrics in list view", () => {
  const items: UnifiedTaskItem[] = [
    makeTeamItem({ status: "pending", statusText: "pending" }),
    makeTeamItem({ id: "team:2", status: "in_progress", statusText: "@tester", iconColor: WARN_COLOR }),
    makeEvalItem({ status: "running", statusText: "running" }),
    makeDelegateItem({ status: "completed", statusText: "done" }),
  ];

  const [primary, secondary] = buildBackgroundTasksSummaryRows(
    items,
    {
      viewMode: "list",
      selectedIndex: 1,
      viewingItem: null,
      resultLines: [],
    },
    60,
  );

  // Should show Pending 1, Active 2 (in_progress + running), Done 1
  assertEquals(primary.includes("Pending 1"), true);
  assertEquals(primary.includes("Active 2"), true);
  assertEquals(primary.includes("Done 1"), true);
  assertEquals(secondary.includes("2/4"), true);
});

Deno.test("buildBackgroundTasksSummaryRows shows result metadata in result view", () => {
  const item = makeDelegateItem({
    label: "Inspect overlay layout stability",
  });
  const [primary, secondary] = buildBackgroundTasksSummaryRows(
    [item],
    {
      viewMode: "result",
      selectedIndex: 0,
      viewingItem: item,
      resultLines: ["a", "b", "c"],
    },
    52,
  );

  assertEquals(primary.includes("Status done"), true);
  assertEquals(primary.includes("3 lines"), true);
  assertEquals(secondary.includes("Inspect overlay layout stability"), true);
});

Deno.test("buildBackgroundTasksSummaryRows shows team task details in result view", () => {
  const item = makeTeamItem({
    label: "#1 Fix authentication",
    statusText: "@alice",
  });
  const [primary, secondary] = buildBackgroundTasksSummaryRows(
    [item],
    {
      viewMode: "result",
      selectedIndex: 0,
      viewingItem: item,
      resultLines: ["Task #1: Fix authentication", "Status: pending"],
    },
    52,
  );

  assertEquals(primary.includes("Status @alice"), true);
  assertEquals(primary.includes("2 lines"), true);
  assertEquals(secondary.includes("shared task"), true);
});

Deno.test("buildBackgroundTasksSummaryRows counts failed tasks", () => {
  const items: UnifiedTaskItem[] = [
    makeEvalItem({ status: "failed", statusText: "failed", iconColor: ERR_COLOR }),
    makeDelegateItem({ status: "failed", statusText: "failed", iconColor: ERR_COLOR }),
  ];

  const [primary] = buildBackgroundTasksSummaryRows(
    items,
    {
      viewMode: "list",
      selectedIndex: 0,
      viewingItem: null,
      resultLines: [],
    },
    60,
  );

  assertEquals(primary.includes("Failed 2"), true);
});

Deno.test("formatBackgroundTaskResultLine turns result dividers into section labels", () => {
  const result = formatBackgroundTaskResultLine("--- Result ---", 20);
  // Should start with the section name followed by separator dashes
  assertEquals(result.startsWith("Result "), true);
  assertEquals(result.includes("\u2500"), true);
  assertEquals(
    formatBackgroundTaskResultLine("plain output", 20),
    "plain output",
  );
});

// === Edge case tests (S1) ===

Deno.test("buildBackgroundTasksSummaryRows handles empty list gracefully", () => {
  const [primary, secondary] = buildBackgroundTasksSummaryRows(
    [],
    {
      viewMode: "list",
      selectedIndex: 0,
      viewingItem: null,
      resultLines: [],
    },
    60,
  );

  assertEquals(primary.includes("Pending 0"), true);
  assertEquals(primary.includes("Active 0"), true);
  assertEquals(primary.includes("Done 0"), true);
  assertEquals(secondary.includes("empty"), true);
});

Deno.test("buildBackgroundTasksSummaryRows counts blocked items as pending", () => {
  const items: UnifiedTaskItem[] = [
    makeTeamItem({ status: "blocked", statusText: "blocked", blocked: true }),
    makeTeamItem({ id: "team:2", status: "pending", statusText: "pending" }),
  ];

  const [primary] = buildBackgroundTasksSummaryRows(
    items,
    {
      viewMode: "list",
      selectedIndex: 0,
      viewingItem: null,
      resultLines: [],
    },
    60,
  );

  // Both blocked and pending should count as "Pending"
  assertEquals(primary.includes("Pending 2"), true);
});

Deno.test("buildBackgroundTasksSummaryRows skips section items in count", () => {
  const section: UnifiedTaskItem = {
    id: "__section_team__",
    kind: "section",
    label: "Agent Tasks",
    status: "",
    statusText: "",
    icon: "",
    iconColor: [0, 0, 0],
    blocked: false,
  };
  const items: UnifiedTaskItem[] = [
    section,
    makeTeamItem({ status: "completed", statusText: "done", iconColor: OK_COLOR }),
  ];

  const [primary, secondary] = buildBackgroundTasksSummaryRows(
    items,
    {
      viewMode: "list",
      selectedIndex: 0,
      viewingItem: null,
      resultLines: [],
    },
    60,
  );

  // Section should not be counted; only 1 real item
  assertEquals(primary.includes("Done 1"), true);
  assertEquals(secondary.includes("1/1"), true);
});

Deno.test("buildBackgroundTasksSummaryRows prioritizes local agent counts when present", () => {
  const items: UnifiedTaskItem[] = [
    {
      id: "teammate:worker-1",
      kind: "local_agent",
      label: "worker-1 · Inspect CLI",
      status: "running",
      statusText: "running",
      icon: "●",
      iconColor: WARN_COLOR,
      blocked: false,
    },
    {
      id: "delegate:1",
      kind: "local_agent",
      label: "alpha · Inspect overlay",
      status: "idle",
      statusText: "idle",
      icon: "○",
      iconColor: MUTED_COLOR,
      blocked: false,
    },
  ];

  const [primary, secondary] = buildBackgroundTasksSummaryRows(
    items,
    {
      viewMode: "list",
      selectedIndex: 0,
      viewingItem: null,
      resultLines: [],
    },
    64,
  );

  assertEquals(primary.includes("2 local agents"), true);
  assertEquals(primary.includes("1 working"), true);
  assertEquals(secondary.includes("Task manager"), true);
});

Deno.test("buildBackgroundTasksSummaryRows clarifies shared tasks when agents and tasks coexist", () => {
  const items: UnifiedTaskItem[] = [
    {
      id: "__section_local_agents__",
      kind: "section",
      label: "Local agents",
      status: "",
      statusText: "",
      icon: "",
      iconColor: MUTED_COLOR,
      blocked: false,
    },
    {
      id: "teammate:worker-1",
      kind: "local_agent",
      label: "worker-1 · Inspect CLI",
      status: "running",
      statusText: "running",
      icon: "●",
      iconColor: WARN_COLOR,
      blocked: false,
    },
    {
      id: "__section_team__",
      kind: "section",
      label: "Shared tasks",
      status: "",
      statusText: "",
      icon: "",
      iconColor: MUTED_COLOR,
      blocked: false,
    },
    {
      id: "team:1",
      kind: "team",
      label: "#1 Remove screenshots",
      status: "in_progress",
      statusText: "@worker-1",
      icon: "●",
      iconColor: WARN_COLOR,
      blocked: false,
    },
  ];

  const [, secondary] = buildBackgroundTasksSummaryRows(
    items,
    {
      viewMode: "list",
      selectedIndex: 0,
      viewingItem: null,
      resultLines: [],
    },
    64,
  );

  assertEquals(secondary.includes("Agents above · shared tasks below"), true);
});
