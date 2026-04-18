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

Deno.test("buildBackgroundTasksSummaryRows shows result metadata in result view", () => {
  const item = makeEvalItem({
    id: "bg:eval-result",
    label: "Inspect overlay layout stability",
    status: "completed",
    statusText: "done",
    icon: "✓",
    iconColor: OK_COLOR,
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

Deno.test("buildBackgroundTasksSummaryRows counts failed tasks", () => {
  const items: UnifiedTaskItem[] = [
    makeEvalItem({ status: "failed", statusText: "failed", iconColor: ERR_COLOR }),
    makeEvalItem({ id: "bg:eval-fail-2", status: "failed", statusText: "failed", iconColor: ERR_COLOR }),
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

Deno.test("buildBackgroundTasksSummaryRows prioritizes local agent counts when present", () => {
  const items: UnifiedTaskItem[] = [
    {
      id: "agent:worker-1",
      kind: "local_agent",
      label: "worker-1 · Inspect CLI",
      status: "running",
      statusText: "running",
      icon: "●",
      iconColor: WARN_COLOR,
      blocked: false,
    },
    {
      id: "agent:1",
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

  assertEquals(primary.includes("2 active agents"), true);
  assertEquals(secondary.includes("1 working"), true);
  assertEquals(secondary.includes("1 idle"), true);
});
