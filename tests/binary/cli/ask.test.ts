import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import { findFreePort, normalizeCliOutput } from "../../shared/light-helpers.ts";
import { binaryTest, runCLI, withTempDir } from "../_shared/binary-helpers.ts";

const platform = getPlatform();
const FIXTURE_PATH = platform.path.fromFileUrl(
  new URL("../../fixtures/ask/agent-transcript-fixture.json", import.meta.url),
);

function assertOrderedSubstrings(output: string, parts: string[]): void {
  let cursor = 0;
  for (const part of parts) {
    const index = output.indexOf(part, cursor);
    assertEquals(index >= 0, true, `Missing "${part}" in output:\n${output}`);
    cursor = index + part.length;
  }
}

binaryTest(
  "CLI ask: fixture-backed default transcript shows todo and delegation progress",
  async () => {
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
  },
);

binaryTest(
  "CLI ask: fixture-backed default transcript stays compact for multi-step requests",
  async () => {
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
  },
);

binaryTest(
  "CLI ask: fixture-backed verbose transcript includes delegate details and final response",
  async () => {
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
        "Exploration complete",
        "Result:\nParent complete",
      ]);
    });
  },
);

binaryTest(
  "CLI ask: fixture-backed json transcript streams NDJSON events",
  async () => {
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
        .map((line) =>
          JSON.parse(line) as { type: string; event?: { type?: string } }
        );
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
  },
);

binaryTest(
  "CLI ask: fixture-backed verbose transcript includes team coordination events",
  async () => {
    await withTempDir(async (dir) => {
      const port = await findFreePort();
      const result = await runCLI(
        "ask",
        [
          "--fresh",
          "--verbose",
          "--model",
          "ollama/test-fixture",
          "coordinate the team runtime",
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
        "[Team Task] in_progress Review parser change",
        "[Team Plan Review] requested for task task-1",
        "Result:\nTeam coordination complete",
      ]);
    });
  },
);

binaryTest(
  "CLI ask: fixture-backed json transcript streams team coordination events",
  async () => {
    await withTempDir(async (dir) => {
      const port = await findFreePort();
      const result = await runCLI(
        "ask",
        [
          "--fresh",
          "--json",
          "--model",
          "ollama/test-fixture",
          "coordinate the team runtime",
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
        .map((line) =>
          JSON.parse(line) as { type: string; event?: { type?: string } }
        );
      assertEquals(
        lines.some((line) =>
          line.type === "agent_event" &&
          line.event?.type === "team_task_updated"
        ),
        true,
      );
      assertEquals(
        lines.some((line) =>
          line.type === "agent_event" &&
          line.event?.type === "team_plan_review_required"
        ),
        true,
      );
      assertEquals(lines.at(-1)?.type, "final");
    });
  },
);

binaryTest(
  "CLI ask: --attach rejects models without media-attachment support",
  async () => {
    await withTempDir(async (dir) => {
      const imagePath = platform.path.join(dir, "sample.png");
      await platform.fs.writeFile(
        imagePath,
        new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      );

      const result = await runCLI(
        "ask",
        [
          "--model",
          "ollama/llama3.1:8b",
          "--attach",
          imagePath,
          "describe this screenshot",
        ],
        {
          cwd: dir,
          env: {
            HLVM_DIR: dir,
          },
        },
      );

      const output = normalizeCliOutput(result.stdout + result.stderr);
      assertEquals(result.success, false, output);
      assertStringIncludes(
        output,
        "Selected model does not support media attachments",
      );
    });
  },
);

binaryTest(
  "CLI ask: natural language request triggers system-managed delegation and team coordination",
  async () => {
    await withTempDir(async (dir) => {
      const port = await findFreePort();
      const result = await runCLI(
        "ask",
        [
          "--fresh",
          "--verbose",
          "--model",
          "ollama/test-fixture",
          "spawn multiple agents and get this parser job done",
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
        "[Delegate] code",
        "[Delegate Result] code",
        "[Team Task] pending Review parser patch",
        "[Team Plan Review] requested for task task-review",
        "Result:\nMulti-agent parser coordination complete",
      ]);
    });
  },
);
