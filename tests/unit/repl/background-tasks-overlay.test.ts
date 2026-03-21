import { assertEquals } from "jsr:@std/assert@1";
import {
  buildBackgroundTasksSummaryRows,
  formatBackgroundTaskResultLine,
} from "../../../src/hlvm/cli/repl-ink/components/BackgroundTasksOverlay.tsx";
import type {
  DelegateTask,
  EvalTask,
  Task,
} from "../../../src/hlvm/cli/repl/task-manager/types.ts";

function makeEvalTask(
  overrides: Partial<EvalTask> = {},
): EvalTask {
  return {
    id: "eval-1",
    type: "eval",
    label: "Evaluate snippet",
    status: "running",
    createdAt: 1,
    code: "(+ 1 2)",
    preview: "Evaluate snippet",
    progress: { status: "evaluating", startedAt: 1 },
    ...overrides,
  };
}

function makeDelegateTask(
  overrides: Partial<DelegateTask> = {},
): DelegateTask {
  return {
    id: "delegate-1",
    type: "delegate",
    label: "Inspect overlay layout",
    status: "completed",
    createdAt: 1,
    agent: "sonnet",
    task: "Inspect overlay layout",
    nickname: "alpha",
    threadId: "thread-1",
    ...overrides,
  };
}

Deno.test("buildBackgroundTasksSummaryRows shows stable task metrics in list view", () => {
  const tasks: Task[] = [
    makeEvalTask({ status: "running" }),
    makeDelegateTask({ id: "delegate-2", status: "completed" }),
    makeDelegateTask({ id: "delegate-3", status: "failed" }),
    makeDelegateTask({ id: "delegate-4", status: "cancelled" }),
  ];

  const [primary, secondary] = buildBackgroundTasksSummaryRows(
    tasks,
    {
      viewMode: "list",
      selectedIndex: 1,
      viewingTask: null,
      resultLines: [],
    },
    56,
  );

  assertEquals(
    primary,
    "Active 1 · Done 1                 Failed 1 · Cancelled 1",
  );
  assertEquals(
    secondary,
    "Eval + delegate tasks                       Selected 2/4",
  );
});

Deno.test("buildBackgroundTasksSummaryRows shows result metadata in result view", () => {
  const task = makeDelegateTask({
    status: "completed",
    label: "Inspect overlay layout stability",
  });
  const [primary, secondary] = buildBackgroundTasksSummaryRows(
    [task],
    {
      viewMode: "result",
      selectedIndex: 0,
      viewingTask: task,
      resultLines: ["a", "b", "c"],
    },
    52,
  );

  assertEquals(primary, "Status completed                             3 lines");
  assertEquals(
    secondary,
    "Inspect overlay layout stability        saved result",
  );
});

Deno.test("formatBackgroundTaskResultLine turns result dividers into section labels", () => {
  assertEquals(
    formatBackgroundTaskResultLine("--- Result ---", 20),
    "Result ─────────────",
  );
  assertEquals(
    formatBackgroundTaskResultLine("plain output", 20),
    "plain output",
  );
});
