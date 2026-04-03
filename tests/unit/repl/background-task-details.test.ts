import { assertEquals } from "jsr:@std/assert@1";
import { buildDelegateTaskDetailLines } from "../../../src/hlvm/cli/repl-ink/components/BackgroundTasksOverlay.tsx";
import type { DelegateTask } from "../../../src/hlvm/cli/repl/task-manager/index.ts";

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
    childSessionId: "child-1",
    ...overrides,
  };
}

Deno.test("buildDelegateTaskDetailLines prefers live child-session progress", () => {
  const lines = buildDelegateTaskDetailLines(
    makeDelegateTask(),
    [
      { role: "user", content: "Inspect the overlay and report progress." },
      { role: "tool", content: "Read(App.tsx)", tool_name: "Read" },
      { role: "tool", content: "Read(BackgroundTasksOverlay.tsx)", tool_name: "Read" },
    ],
  );

  assertEquals(lines.includes("--- Prompt ---"), true);
  assertEquals(lines.includes("--- Progress ---"), true);
  assertEquals(lines.some((line) => line.includes("Read: Read(App.tsx)")), true);
  assertEquals(lines.some((line) => line.startsWith("Thread:")), false);
  assertEquals(lines.some((line) => line.startsWith("Session:")), false);
});

Deno.test("buildDelegateTaskDetailLines falls back to final summary and error", () => {
  const lines = buildDelegateTaskDetailLines(
    makeDelegateTask({
      status: "failed",
      summary: "Finished checking the overlay.",
      error: new Error("tool failed"),
    }),
    [],
  );

  assertEquals(lines.includes("--- Result ---"), true);
  assertEquals(lines.includes("--- Error ---"), true);
});
