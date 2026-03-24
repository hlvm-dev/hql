/**
 * E2E tests for Claude Code CLI parity: headless mode and fine-grained permissions
 *
 * These tests verify the behavior of:
 * - -p/--print flag (headless mode)
 * - --allow-tool and --deny-tool flags
 * - Tool blocking behavior (tools get blocked, errors logged)
 *
 * Note: Exit codes 2/3 only occur when blocked tools prevent query completion.
 * If the agent can work around a blocked tool, the query succeeds with exit code 0.
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import { EXIT_CODES } from "../../../src/hlvm/agent/constants.ts";
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
          "--stateless",
          "--model",
          "ollama/test-fixture",
          "do something",
        ],
        {
          cwd: dir,
          env: {
            HLVM_DIR: dir,
            HLVM_REPL_PORT: String(port),
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
        },
      );

      const output = normalizeCliOutput(result.stdout + result.stderr);
      // Verify ask_user was attempted and blocked
      assertStringIncludes(
        output,
        "ask_user",
        "Expected ask_user tool to be attempted",
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
          "--stateless",
          "--model",
          "ollama/test-fixture",
          "delete files",
        ],
        {
          cwd: dir,
          env: {
            HLVM_DIR: dir,
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
      assertStringIncludes(
        output,
        "TOOL_BLOCKED",
        "Expected TOOL_BLOCKED error to be logged",
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
          "--stateless",
          "--model",
          "ollama/test-fixture",
          "read files",
        ],
        {
          cwd: dir,
          env: {
            HLVM_DIR: dir,
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
  "CLI ask: explicit --allow-tool in headless mode succeeds",
  async () => {
    await withTempDir(async (dir) => {
      const port = await findFreePort();
      const fixturePath = platform.path.join(dir, "unsafe_tool_fixture.json");
      await platform.fs.writeFile(fixturePath, encoder.encode(UNSAFE_TOOL_FIXTURE));

      const result = await runCLI(
        "ask",
        [
          "-p",
          "--allow-tool",
          "shell_exec",
          "--stateless",
          "--model",
          "ollama/test-fixture",
          "delete files",
        ],
        {
          cwd: dir,
          env: {
            HLVM_DIR: dir,
            HLVM_REPL_PORT: String(port),
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
        },
      );

      const output = normalizeCliOutput(result.stdout + result.stderr);
      assertEquals(
        result.success,
        true,
        `Expected success with --allow-tool, got: ${output}`,
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
  "CLI ask: explicit --deny-tool blocks tool even in yolo mode",
  async () => {
    await withTempDir(async (dir) => {
      const port = await findFreePort();
      const fixturePath = platform.path.join(dir, "safe_tool_fixture.json");
      await platform.fs.writeFile(fixturePath, encoder.encode(SAFE_TOOL_FIXTURE));

      const result = await runCLI(
        "ask",
        [
          "--dangerously-skip-permissions",
          "--deny-tool",
          "read_file",
          "--stateless",
          "--model",
          "ollama/test-fixture",
          "read files",
        ],
        {
          cwd: dir,
          env: {
            HLVM_DIR: dir,
            HLVM_REPL_PORT: String(port),
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
        },
      );

      const output = normalizeCliOutput(result.stdout + result.stderr);
      // Verify read_file was blocked by explicit --deny-tool
      assertStringIncludes(
        output,
        "read_file",
        "Expected read_file tool to be attempted",
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
  "CLI ask: multiple --allow-tool flags work together",
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
          "--allow-tool",
          "read_file",
          "--allow-tool",
          "write_file",
          "--stateless",
          "--model",
          "ollama/test-fixture",
          "process files",
        ],
        {
          cwd: dir,
          env: {
            HLVM_DIR: dir,
            HLVM_REPL_PORT: String(port),
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
        },
      );

      const output = normalizeCliOutput(result.stdout + result.stderr);
      assertEquals(
        result.success,
        true,
        `Expected success with multiple --allow-tool flags, got: ${output}`,
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
          "--stateless",
          "--model",
          "ollama/test-fixture",
          "delete files",
        ],
        {
          cwd: dir,
          env: {
            HLVM_DIR: dir,
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
      assertStringIncludes(
        output,
        "TOOL_BLOCKED",
        "Expected TOOL_BLOCKED error to be logged",
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
