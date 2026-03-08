import { assertEquals } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { findFreePort } from "../../shared/light-helpers.ts";
import {
  binaryTest,
  runCLI,
  withTempDir,
} from "../_shared/binary-helpers.ts";

const platform = getPlatform();
const FIXTURE_PATH = platform.path.fromFileUrl(
  new URL("../../fixtures/ask/agent-transcript-fixture.json", import.meta.url),
);

function normalizeCliOutput(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n");
}

function assertOrderedSubstrings(output: string, parts: string[]): void {
  let cursor = 0;
  for (const part of parts) {
    const index = output.indexOf(part, cursor);
    assertEquals(index >= 0, true, `Missing "${part}" in output:\n${output}`);
    cursor = index + part.length;
  }
}

binaryTest("CLI ask: fixture-backed default transcript shows todo and delegation progress", async () => {
  await withTempDir(async (dir) => {
    const port = await findFreePort();
    const result = await runCLI(
      "ask",
      ["--fresh", "--model", "ollama/test-fixture", "inspect the project"],
      {
        cwd: dir,
        env: {
          HLVM_DIR: dir,
          HLVM_REPL_PORT: String(port),
          HLVM_ASK_FIXTURE_PATH: FIXTURE_PATH,
        },
      },
    );

    const output = normalizeCliOutput(result.stdout + result.stderr);
    assertEquals(result.success, true, output);
    assertOrderedSubstrings(output, [
      "todo_write",
      "1 todo",
      "delegate web",
      "Exploration complete",
      "Parent complete",
    ]);
    assertEquals(output.includes("[Delegate]"), false, output);
    assertEquals(output.includes("Result:"), false, output);
  });
});

binaryTest("CLI ask: fixture-backed default transcript stays compact for multi-step requests", async () => {
  await withTempDir(async (dir) => {
    const port = await findFreePort();
    const result = await runCLI(
      "ask",
      [
        "--fresh",
        "--model",
        "ollama/test-fixture",
        "inspect the project and summarize findings",
      ],
      {
        cwd: dir,
        env: {
          HLVM_DIR: dir,
          HLVM_REPL_PORT: String(port),
          HLVM_ASK_FIXTURE_PATH: FIXTURE_PATH,
        },
      },
    );

    const output = normalizeCliOutput(result.stdout + result.stderr);
    assertEquals(result.success, true, output);
    assertOrderedSubstrings(output, [
      "todo_write",
      "delegate web",
      "Parent complete",
    ]);
    assertEquals(output.includes("Plan"), false, output);
    assertEquals(output.includes("Todo ->"), false, output);
  });
});

binaryTest("CLI ask: fixture-backed verbose transcript includes delegate details and final response", async () => {
  await withTempDir(async (dir) => {
    const port = await findFreePort();
    const result = await runCLI(
      "ask",
      [
        "--fresh",
        "--verbose",
        "--model",
        "ollama/test-fixture",
        "inspect the project",
      ],
      {
        cwd: dir,
        env: {
          HLVM_DIR: dir,
          HLVM_REPL_PORT: String(port),
          HLVM_ASK_FIXTURE_PATH: FIXTURE_PATH,
        },
      },
    );

    const output = normalizeCliOutput(result.stdout + result.stderr);
    assertEquals(result.success, true, output);
    assertOrderedSubstrings(output, [
      "[Delegate] web",
      "[Delegate Result] web",
      "Child transcript:",
      "Tool read_file",
      "Exploration complete",
      "Result:\nParent complete",
    ]);
  });
});

binaryTest("CLI ask: fixture-backed json transcript streams NDJSON events", async () => {
  await withTempDir(async (dir) => {
    const port = await findFreePort();
    const result = await runCLI(
      "ask",
      [
        "--fresh",
        "--json",
        "--model",
        "ollama/test-fixture",
        "inspect the project and summarize findings",
      ],
      {
        cwd: dir,
        env: {
          HLVM_DIR: dir,
          HLVM_REPL_PORT: String(port),
          HLVM_ASK_FIXTURE_PATH: FIXTURE_PATH,
        },
      },
    );

    const output = normalizeCliOutput(result.stdout + result.stderr).trim();
    assertEquals(result.success, true, output);
    const lines = output
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; event?: { type?: string } });
    assertEquals(lines.at(-1)?.type, "final");
    assertEquals(
      lines.some((line) =>
        line.type === "agent_event" && line.event?.type === "plan_created"
      ),
      true,
    );
    assertEquals(
      lines.some((line) =>
        line.type === "agent_event" && line.event?.type === "delegate_end"
      ),
      true,
    );
    assertEquals(lines.some((line) => line.type === "final"), true);
  });
});
