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
    assertEquals(output.includes("todo_write"), true, output);
    assertEquals(output.includes("1 todo"), true, output);
    assertEquals(output.includes("delegate web"), true, output);
    assertEquals(output.includes("Exploration complete"), true, output);
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
    assertEquals(output.includes("[Delegate] web"), true, output);
    assertEquals(output.includes("[Delegate Result] web"), true, output);
    assertEquals(output.includes("Exploration complete"), true, output);
    assertEquals(output.includes("Result:\nParent complete"), true, output);
  });
});
