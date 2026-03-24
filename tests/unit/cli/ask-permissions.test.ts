import { assertEquals } from "jsr:@std/assert";
import { EXIT_CODES } from "../../../src/hlvm/agent/constants.ts";

/**
 * Mock function to simulate parseAskArgs behavior
 * This extracts the parsing logic for testing
 */
function parseAskFlags(args: string[]): {
  headless: boolean;
  allowedTools: Set<string>;
  deniedTools: Set<string>;
  permissionMode: string;
} {
  let headless = false;
  let permissionMode = "default";
  const allowedTools = new Set<string>();
  const deniedTools = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-p" || arg === "--print") {
      headless = true;
    } else if (arg === "--dangerously-skip-permissions") {
      permissionMode = "yolo";
    } else if (arg === "--allow-tool") {
      const toolName = args[++i];
      if (toolName) allowedTools.add(toolName);
    } else if (arg === "--deny-tool") {
      const toolName = args[++i];
      if (toolName) deniedTools.add(toolName);
    } else if (arg === "--allowed-tools") {
      const tools = args[++i];
      if (tools) {
        tools.split(",").map((t) => t.trim()).filter(Boolean).forEach((t) =>
          allowedTools.add(t)
        );
      }
    } else if (arg === "--denied-tools") {
      const tools = args[++i];
      if (tools) {
        tools.split(",").map((t) => t.trim()).filter(Boolean).forEach((t) =>
          deniedTools.add(t)
        );
      }
    }
  }

  return { headless, allowedTools, deniedTools, permissionMode };
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

Deno.test("CLI ask: --allow-tool adds to allowedTools", () => {
  const result = parseAskFlags(["--allow-tool", "write_file", "test query"]);
  assertEquals(result.allowedTools.has("write_file"), true);
  assertEquals(result.allowedTools.size, 1);
});

Deno.test("CLI ask: --deny-tool adds to deniedTools", () => {
  const result = parseAskFlags(["--deny-tool", "shell_exec", "test query"]);
  assertEquals(result.deniedTools.has("shell_exec"), true);
  assertEquals(result.deniedTools.size, 1);
});

Deno.test("CLI ask: --allowed-tools parses CSV correctly", () => {
  const result = parseAskFlags([
    "--allowed-tools",
    "write_file,read_file,git_status",
    "test query",
  ]);
  assertEquals(result.allowedTools.has("write_file"), true);
  assertEquals(result.allowedTools.has("read_file"), true);
  assertEquals(result.allowedTools.has("git_status"), true);
  assertEquals(result.allowedTools.size, 3);
});

Deno.test("CLI ask: --denied-tools parses CSV correctly", () => {
  const result = parseAskFlags([
    "--denied-tools",
    "shell_exec,delete_file",
    "test query",
  ]);
  assertEquals(result.deniedTools.has("shell_exec"), true);
  assertEquals(result.deniedTools.has("delete_file"), true);
  assertEquals(result.deniedTools.size, 2);
});

Deno.test("CLI ask: multiple --allow-tool flags accumulate", () => {
  const result = parseAskFlags([
    "--allow-tool",
    "write_file",
    "--allow-tool",
    "read_file",
    "--allow-tool",
    "git_status",
    "test query",
  ]);
  assertEquals(result.allowedTools.has("write_file"), true);
  assertEquals(result.allowedTools.has("read_file"), true);
  assertEquals(result.allowedTools.has("git_status"), true);
  assertEquals(result.allowedTools.size, 3);
});

Deno.test("CLI ask: multiple --deny-tool flags accumulate", () => {
  const result = parseAskFlags([
    "--deny-tool",
    "shell_exec",
    "--deny-tool",
    "delete_file",
    "test query",
  ]);
  assertEquals(result.deniedTools.has("shell_exec"), true);
  assertEquals(result.deniedTools.has("delete_file"), true);
  assertEquals(result.deniedTools.size, 2);
});

Deno.test("CLI ask: --dangerously-skip-permissions sets yolo mode", () => {
  const result = parseAskFlags(["--dangerously-skip-permissions", "test query"]);
  assertEquals(result.permissionMode, "yolo");
});

Deno.test("CLI ask: flags can be combined", () => {
  const result = parseAskFlags([
    "-p",
    "--allow-tool",
    "read_file",
    "--deny-tool",
    "delete_file",
    "test query",
  ]);
  assertEquals(result.headless, true);
  assertEquals(result.allowedTools.has("read_file"), true);
  assertEquals(result.deniedTools.has("delete_file"), true);
});

// ---------------------------------------------------------------------------
// Exit Code Tests
// ---------------------------------------------------------------------------

Deno.test("CLI ask: getExitCodeForError returns 3 for INTERACTION_BLOCKED", () => {
  const error = new Error("[INTERACTION_BLOCKED] ask_user is not allowed in headless mode");
  const code = getExitCodeForErrorTest(error);
  assertEquals(code, EXIT_CODES.INTERACTION_BLOCKED);
});

Deno.test("CLI ask: getExitCodeForError returns 2 for TOOL_BLOCKED", () => {
  const error = new Error("[TOOL_BLOCKED] shell_exec is blocked in headless mode");
  const code = getExitCodeForErrorTest(error);
  assertEquals(code, EXIT_CODES.TOOL_BLOCKED);
});

Deno.test("CLI ask: getExitCodeForError returns 1 for general errors", () => {
  const error = new Error("Some general error");
  const code = getExitCodeForErrorTest(error);
  assertEquals(code, EXIT_CODES.GENERAL_FAILURE);
});

Deno.test("CLI ask: getExitCodeForError handles string errors", () => {
  const error = "[TOOL_BLOCKED] blocked";
  const code = getExitCodeForErrorTest(error);
  assertEquals(code, EXIT_CODES.TOOL_BLOCKED);
});

// Test helper that mirrors the actual implementation
function getExitCodeForErrorTest(error: unknown): number {
  const errorMsg = error instanceof Error ? error.message : String(error);

  if (errorMsg.includes("[INTERACTION_BLOCKED]")) {
    return EXIT_CODES.INTERACTION_BLOCKED;
  }

  if (errorMsg.includes("[TOOL_BLOCKED]")) {
    return EXIT_CODES.TOOL_BLOCKED;
  }

  return EXIT_CODES.GENERAL_FAILURE;
}
