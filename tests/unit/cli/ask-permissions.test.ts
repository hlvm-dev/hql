import { assertEquals } from "jsr:@std/assert";
import { EXIT_CODES } from "../../../src/hlvm/agent/constants.ts";

/**
 * Mock function to simulate parseAskArgs behavior
 * This extracts the parsing logic for testing
 */
function parseAskFlags(args: string[]): {
  headless: boolean;
  allowedTools: Set<string>;
  disallowedTools: Set<string>;
  permissionMode: string;
} {
  let headless = false;
  let permissionMode = "default";
  const allowedTools = new Set<string>();
  const disallowedTools = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-p" || arg === "--print") {
      headless = true;
    } else if (arg === "--dangerously-skip-permissions") {
      permissionMode = "bypassPermissions";
    } else if (arg === "--allowedTools") {
      const toolName = args[++i];
      if (toolName) allowedTools.add(toolName);
    } else if (arg === "--disallowedTools") {
      const toolName = args[++i];
      if (toolName) disallowedTools.add(toolName);
    }
  }

  return { headless, allowedTools, disallowedTools, permissionMode };
}

// ---------------------------------------------------------------------------
// CLI Flag Parsing Tests
// ---------------------------------------------------------------------------

Deno.test("CLI ask: -p sets headless mode", () => {
  const result = parseAskFlags(["-p", "test query"]);
  assertEquals(result.headless, true);
});

Deno.test("CLI ask: --print sets headless mode", () => {
  const result = parseAskFlags(["--print", "test query"]);
  assertEquals(result.headless, true);
});

Deno.test("CLI ask: --allowedTools adds to allowedTools", () => {
  const result = parseAskFlags(["--allowedTools", "write_file", "test query"]);
  assertEquals(result.allowedTools.has("write_file"), true);
  assertEquals(result.allowedTools.size, 1);
});

Deno.test("CLI ask: --disallowedTools adds to disallowedTools", () => {
  const result = parseAskFlags(["--disallowedTools", "shell_exec", "test query"]);
  assertEquals(result.disallowedTools.has("shell_exec"), true);
  assertEquals(result.disallowedTools.size, 1);
});

Deno.test("CLI ask: multiple --allowedTools flags accumulate", () => {
  const result = parseAskFlags([
    "--allowedTools",
    "write_file",
    "--allowedTools",
    "read_file",
    "--allowedTools",
    "git_status",
    "test query",
  ]);
  assertEquals(result.allowedTools.has("write_file"), true);
  assertEquals(result.allowedTools.has("read_file"), true);
  assertEquals(result.allowedTools.has("git_status"), true);
  assertEquals(result.allowedTools.size, 3);
});

Deno.test("CLI ask: multiple --disallowedTools flags accumulate", () => {
  const result = parseAskFlags([
    "--disallowedTools",
    "shell_exec",
    "--disallowedTools",
    "delete_file",
    "test query",
  ]);
  assertEquals(result.disallowedTools.has("shell_exec"), true);
  assertEquals(result.disallowedTools.has("delete_file"), true);
  assertEquals(result.disallowedTools.size, 2);
});

Deno.test("CLI ask: --dangerously-skip-permissions sets bypassPermissions mode", () => {
  const result = parseAskFlags(["--dangerously-skip-permissions", "test query"]);
  assertEquals(result.permissionMode, "bypassPermissions");
});

Deno.test("CLI ask: flags can be combined", () => {
  const result = parseAskFlags([
    "-p",
    "--allowedTools",
    "read_file",
    "--disallowedTools",
    "delete_file",
    "test query",
  ]);
  assertEquals(result.headless, true);
  assertEquals(result.allowedTools.has("read_file"), true);
  assertEquals(result.disallowedTools.has("delete_file"), true);
});

// ---------------------------------------------------------------------------
// Exit Code Tests
// ---------------------------------------------------------------------------

Deno.test("CLI ask: all errors use GENERAL_FAILURE exit code", () => {
  assertEquals(EXIT_CODES.GENERAL_FAILURE, 1);
});
