/**
 * Run multiple `deno task` commands concurrently and fail fast on aggregate status.
 *
 * Usage:
 *   deno run -A scripts/run-tasks-parallel.ts test:unit test:binary test:compat
 */

import { getPlatform } from "../src/platform/platform.ts";

const platform = getPlatform();

interface TaskStatus {
  name: string;
  code: number;
  success: boolean;
}

async function runTask(name: string): Promise<TaskStatus> {
  const child = platform.command.run({
    cmd: ["deno", "task", name],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await child.status;
  return {
    name,
    code: status.code,
    success: status.success,
  };
}

const taskNames = platform.process.args().map((arg) => arg.trim()).filter((arg) => arg.length > 0);

if (taskNames.length === 0) {
  console.error("Usage: deno run -A scripts/run-tasks-parallel.ts <task> [task...]");
  platform.process.exit(1);
}

const results = await Promise.all(taskNames.map((name) => runTask(name)));
const failed = results.filter((result) => !result.success);

if (failed.length > 0) {
  const summary = failed.map((result) => `${result.name} (exit ${result.code})`).join(", ");
  console.error(`Parallel task failure: ${summary}`);
  platform.process.exit(1);
}
