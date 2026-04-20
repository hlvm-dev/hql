/**
 * E2E tests for Claude Code CLI parity: headless mode and fine-grained permissions
 *
 * These tests verify the behavior of:
 * - -p/--print flag (headless mode)
 * - --allowedTools and --disallowedTools flags
 * - Tool blocking behavior (tools get blocked, errors logged)
 *
 * Note: Blocked tools result in exit code 0 if the agent can work around them,
 * or exit code 1 (GENERAL_FAILURE) if the query cannot be completed.
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import { EXIT_CODES } from "../../../src/hlvm/agent/constants.ts";
import { findListeningPidForPort } from "../../../src/hlvm/runtime/port-process.ts";
import { findFreePort, normalizeCliOutput } from "../../shared/light-helpers.ts";
import { binaryTest, runCLI, withTempDir } from "../_shared/binary-helpers.ts";

const platform = getPlatform();
const encoder = new TextEncoder();

// Create a simple fixture that attempts to use ask_user
const ASK_USER_FIXTURE = JSON.stringify({
  version: 1,
  name: "ask_user fixture",
  cases: [
    {
      name: "default",
      steps: [
        {
          toolCalls: [
            {
              id: "call_1",
              toolName: "ask_user",
              args: { question: "What should I do?" },
            },
          ],
        },
        {
          response: "Task complete",
        },
      ],
    },
  ],
});

// Create a fixture that attempts to use an unsafe tool
const UNSAFE_TOOL_FIXTURE = JSON.stringify({
  version: 1,
  name: "unsafe tool fixture",
  cases: [
    {
      name: "default",
      steps: [
        {
          toolCalls: [
            {
              id: "call_1",
              toolName: "shell_exec",
              args: { command: "rm -rf important_file" },
            },
          ],
        },
        {
          response: "Task complete",
        },
      ],
    },
  ],
});

// Create a fixture that uses safe tools
const SAFE_TOOL_FIXTURE = JSON.stringify({
  version: 1,
  name: "safe tool fixture",
  cases: [
    {
      name: "default",
      steps: [
        {
          toolCalls: [
            {
              id: "call_1",
              toolName: "read_file",
              args: { path: "README.md" },
            },
          ],
        },
        {
          response: "Task complete",
        },
      ],
    },
  ],
});

binaryTest(
  "CLI ask: headless mode logs ask_user tool blocking",
  async () => {
    await withTempDir(async (dir) => {
      const port = await findFreePort();
      const fixturePath = platform.path.join(dir, "ask_user_fixture.json");
      await platform.fs.writeFile(fixturePath, encoder.encode(ASK_USER_FIXTURE));

      const result = await runCLI(
        "ask",
        [
          "-p",
          "--no-session-persistence",
          "--model",
          "ollama/test-fixture",
          "do something",
        ],
        {
          cwd: dir,
          env: {
            HLVM_TEST_STATE_ROOT: dir,
            HLVM_ALLOW_TEST_STATE_ROOT: "1",
            HLVM_REPL_PORT: String(port),
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
        },
      );

      const output = normalizeCliOutput(result.stdout + result.stderr);
      // Verify ask_user was attempted and blocked
      assertStringIncludes(
        output,
        "Ask(\"What should I do?\")",
        "Expected the ask_user interaction to appear in the transcript",
      );
      // Agent completes successfully because it can work around the blocked tool
      assertEquals(
        result.success,
        true,
        `Expected success (agent recovers from blocked tool), got: ${output}`,
      );
    });
  },
);

binaryTest(
  "CLI ask: headless mode logs unsafe tool blocking",
  async () => {
    await withTempDir(async (dir) => {
      const port = await findFreePort();
      const fixturePath = platform.path.join(dir, "unsafe_tool_fixture.json");
      await platform.fs.writeFile(fixturePath, encoder.encode(UNSAFE_TOOL_FIXTURE));

      const result = await runCLI(
        "ask",
        [
          "-p",
          "--no-session-persistence",
          "--model",
          "ollama/test-fixture",
          "delete files",
        ],
        {
          cwd: dir,
          env: {
            HLVM_TEST_STATE_ROOT: dir,
            HLVM_ALLOW_TEST_STATE_ROOT: "1",
            HLVM_REPL_PORT: String(port),
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
        },
      );

      const output = normalizeCliOutput(result.stdout + result.stderr);
      // Verify shell_exec was attempted and blocked
      assertStringIncludes(
        output,
        "shell_exec",
        "Expected shell_exec tool to be attempted",
      );
      // Agent completes successfully because it can work around the blocked tool
      assertEquals(
        result.success,
        true,
        `Expected success (agent recovers from blocked tool), got: ${output}`,
      );
    });
  },
);

binaryTest(
  "CLI ask: headless mode allows safe tools with exit code 0",
  async () => {
    await withTempDir(async (dir) => {
      const port = await findFreePort();
      const fixturePath = platform.path.join(dir, "safe_tool_fixture.json");
      await platform.fs.writeFile(fixturePath, encoder.encode(SAFE_TOOL_FIXTURE));

      // Create README.md for the read_file tool to read
      await platform.fs.writeFile(
        platform.path.join(dir, "README.md"),
        encoder.encode("# Test Project"),
      );

      const result = await runCLI(
        "ask",
        [
          "-p",
          "--no-session-persistence",
          "--model",
          "ollama/test-fixture",
          "read files",
        ],
        {
          cwd: dir,
          env: {
            HLVM_TEST_STATE_ROOT: dir,
            HLVM_ALLOW_TEST_STATE_ROOT: "1",
            HLVM_REPL_PORT: String(port),
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
        },
      );

      const output = normalizeCliOutput(result.stdout + result.stderr);
      assertEquals(
        result.success,
        true,
        `Expected success, got: ${output}`,
      );
      assertEquals(
        result.code,
        EXIT_CODES.SUCCESS,
        `Expected exit code ${EXIT_CODES.SUCCESS}, got ${result.code}. Output: ${output}`,
      );
    });
  },
);

binaryTest(
  "CLI ask: explicit --allowedTools in headless mode succeeds",
  async () => {
    await withTempDir(async (dir) => {
      const port = await findFreePort();
      const fixturePath = platform.path.join(dir, "unsafe_tool_fixture.json");
      await platform.fs.writeFile(fixturePath, encoder.encode(UNSAFE_TOOL_FIXTURE));

      const result = await runCLI(
        "ask",
        [
          "-p",
          "--allowedTools",
          "shell_exec",
          "--no-session-persistence",
          "--model",
          "ollama/test-fixture",
          "delete files",
        ],
        {
          cwd: dir,
          env: {
            HLVM_TEST_STATE_ROOT: dir,
            HLVM_ALLOW_TEST_STATE_ROOT: "1",
            HLVM_REPL_PORT: String(port),
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
        },
      );

      const output = normalizeCliOutput(result.stdout + result.stderr);
      assertEquals(
        result.success,
        true,
        `Expected success with --allowedTools, got: ${output}`,
      );
      assertEquals(
        result.code,
        EXIT_CODES.SUCCESS,
        `Expected exit code ${EXIT_CODES.SUCCESS}, got ${result.code}. Output: ${output}`,
      );
    });
  },
);

binaryTest(
  "CLI ask: explicit --disallowedTools blocks tool even in bypassPermissions mode",
  async () => {
    await withTempDir(async (dir) => {
      const port = await findFreePort();
      const fixturePath = platform.path.join(dir, "safe_tool_fixture.json");
      await platform.fs.writeFile(fixturePath, encoder.encode(SAFE_TOOL_FIXTURE));

      const result = await runCLI(
        "ask",
        [
          "--dangerously-skip-permissions",
          "--disallowedTools",
          "read_file",
          "--no-session-persistence",
          "--model",
          "ollama/test-fixture",
          "read files",
        ],
        {
          cwd: dir,
          env: {
            HLVM_TEST_STATE_ROOT: dir,
            HLVM_ALLOW_TEST_STATE_ROOT: "1",
            HLVM_REPL_PORT: String(port),
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
        },
      );

      const output = normalizeCliOutput(result.stdout + result.stderr);
      // Verify read_file was blocked by explicit --disallowedTools
      assertStringIncludes(
        output,
        "Read(README.md)",
        "Expected the read_file interaction to appear in the transcript",
      );
      // Agent completes successfully because it can work around the blocked tool
      assertEquals(
        result.success,
        true,
        `Expected success (agent recovers from blocked tool), got: ${output}`,
      );
    });
  },
);

binaryTest(
  "CLI ask: multiple --allowedTools flags work together",
  async () => {
    await withTempDir(async (dir) => {
      const port = await findFreePort();

      // Create a fixture that uses multiple tools
      const multiToolFixture = JSON.stringify({
        version: 1,
        name: "multi tool fixture",
        cases: [
          {
            name: "default",
            steps: [
              {
                toolCalls: [
                  {
                    id: "call_1",
                    toolName: "read_file",
                    args: { path: "test.txt" },
                  },
                ],
              },
              {
                toolCalls: [
                  {
                    id: "call_2",
                    toolName: "write_file",
                    args: { path: "output.txt", content: "result" },
                  },
                ],
              },
              {
                response: "Complete",
              },
            ],
          },
        ],
      });

      const fixturePath = platform.path.join(dir, "multi_tool_fixture.json");
      await platform.fs.writeFile(fixturePath, encoder.encode(multiToolFixture));
      await platform.fs.writeFile(
        platform.path.join(dir, "test.txt"),
        encoder.encode("test content"),
      );

      const result = await runCLI(
        "ask",
        [
          "-p",
          "--allowedTools",
          "read_file",
          "--allowedTools",
          "write_file",
          "--no-session-persistence",
          "--model",
          "ollama/test-fixture",
          "process files",
        ],
        {
          cwd: dir,
          env: {
            HLVM_TEST_STATE_ROOT: dir,
            HLVM_ALLOW_TEST_STATE_ROOT: "1",
            HLVM_REPL_PORT: String(port),
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
        },
      );

      const output = normalizeCliOutput(result.stdout + result.stderr);
      assertEquals(
        result.success,
        true,
        `Expected success with multiple --allowedTools flags, got: ${output}`,
      );
      assertEquals(result.code, EXIT_CODES.SUCCESS);
    });
  },
);

binaryTest(
  "CLI ask: --print is equivalent to -p for tool blocking",
  async () => {
    await withTempDir(async (dir) => {
      const port = await findFreePort();
      const fixturePath = platform.path.join(dir, "unsafe_tool_fixture.json");
      await platform.fs.writeFile(fixturePath, encoder.encode(UNSAFE_TOOL_FIXTURE));

      const result = await runCLI(
        "ask",
        [
          "--print",
          "--no-session-persistence",
          "--model",
          "ollama/test-fixture",
          "delete files",
        ],
        {
          cwd: dir,
          env: {
            HLVM_TEST_STATE_ROOT: dir,
            HLVM_ALLOW_TEST_STATE_ROOT: "1",
            HLVM_REPL_PORT: String(port),
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
        },
      );

      const output = normalizeCliOutput(result.stdout + result.stderr);
      // Verify shell_exec was blocked (same as -p test)
      assertStringIncludes(
        output,
        "shell_exec",
        "Expected shell_exec tool to be attempted",
      );
      // Agent completes successfully because it can work around the blocked tool
      assertEquals(
        result.success,
        true,
        `Expected success (agent recovers from blocked tool), got: ${output}`,
      );
    });
  },
);

Deno.test(
  "CLI ask: ephemeral test-mode shuts down spawned serve on exit (direct invocation, no test-helper cleanup)",
  async () => {
    const dir = await platform.fs.makeTempDir({ prefix: "hlvm-ask-ephem-" });
    try {
      const port = await findFreePort();
      const fixturePath = platform.path.join(dir, "safe_tool_fixture.json");
      await platform.fs.writeFile(fixturePath, encoder.encode(SAFE_TOOL_FIXTURE));
      await platform.fs.writeFile(
        platform.path.join(dir, "README.md"),
        encoder.encode("# Test Project"),
      );

      const cliPath = new URL("../../../src/hlvm/cli/cli.ts", import.meta.url)
        .pathname;
      const output = await platform.command.output({
        cmd: [
          "deno",
          "run",
          "-A",
          cliPath,
          "ask",
          "-p",
          "--no-session-persistence",
          "--model",
          "ollama/test-fixture",
          "read files",
        ],
        cwd: dir,
        env: {
          ...platform.env.toObject(),
          HLVM_TEST_STATE_ROOT: dir,
          HLVM_ALLOW_TEST_STATE_ROOT: "1",
          HLVM_DISABLE_AI_AUTOSTART: "1",
          HLVM_REPL_PORT: String(port),
          HLVM_ASK_FIXTURE_PATH: fixturePath,
        },
        stdout: "piped",
        stderr: "piped",
      });
      assertEquals(
        output.success,
        true,
        `ask failed: ${new TextDecoder().decode(output.stderr)}`,
      );

      const leakedPid = await findListeningPidForPort(port);
      if (leakedPid) {
        try {
          await platform.command.output({
            cmd: ["kill", leakedPid],
            stdout: "null",
            stderr: "null",
          });
        } catch {
          // best-effort cleanup so a failure here does not poison other tests
        }
      }
      assertEquals(
        leakedPid,
        null,
        `Ephemeral ask leaked a serve on port ${port} (pid=${leakedPid})`,
      );
    } finally {
      await platform.fs.remove(dir, { recursive: true }).catch(() => {});
    }
  },
);
