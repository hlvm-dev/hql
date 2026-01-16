/**
 * Eval task result formatting helpers.
 * Shared by background task panel and overlay.
 */

import type { EvalTask } from "../../repl/task-manager/types.ts";

const STATUS_ORDER: Record<string, number> = {
  running: 0,
  pending: 1,
  completed: 2,
  failed: 3,
  cancelled: 4,
};

function safeStringify(value: unknown, spacing = 2): string {
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === "bigint") return `${val}n`;
        if (typeof val === "function") return "[Function]";
        if (typeof val === "symbol") return String(val);
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        return val;
      },
      spacing
    );
    if (json !== undefined) return json;
  } catch {
    // Fall through to string conversion.
  }
  try {
    return String(value);
  } catch {
    return "[Unserializable]";
  }
}

export function formatEvalTaskResultLines(task: EvalTask): string[] {
  const outputLines = task.output ? task.output.split("\n") : [];

  if (task.status === "completed") {
    if (task.result !== undefined) {
      const resultStr = typeof task.result === "string"
        ? task.result
        : safeStringify(task.result, 2);
      return resultStr.split("\n");
    }
    return outputLines;
  }

  if (task.status === "failed") {
    const errLine = task.error ? `Error: ${task.error.message}` : "Error: Unknown failure";
    return outputLines.length > 0 ? [...outputLines, errLine] : [errLine];
  }

  if (task.status === "running") {
    return outputLines.length > 0 ? outputLines : ["Still evaluating..."];
  }

  if (task.status === "cancelled") {
    const cancelLine = "Evaluation was cancelled";
    return outputLines.length > 0 ? [...outputLines, cancelLine] : [cancelLine];
  }

  return outputLines;
}

export function sortEvalTasks(tasks: EvalTask[]): EvalTask[] {
  return [...tasks].sort((a, b) => {
    return (STATUS_ORDER[a.status] ?? 5) - (STATUS_ORDER[b.status] ?? 5);
  });
}
