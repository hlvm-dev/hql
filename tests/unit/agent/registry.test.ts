/**
 * Tool Registry Tests
 *
 * Verifies tool registry functionality
 */

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert";
import {
  getAllTools,
  getTool,
  getToolArgSchema,
  getToolCount,
  getToolDescription,
  getToolsByCategory,
  hasTool,
  registerTool,
  resolveTools,
  searchTools,
  unregisterTool,
  validateToolArgs,
} from "../../../src/hlvm/agent/registry.ts";

// ============================================================
// getTool tests
// ============================================================

Deno.test({
  name: "Registry: getTool - get valid tool with complete metadata",
  fn() {
    const tool = getTool("read_file");
    // Verify tool has all required fields with meaningful content
    assertEquals(typeof tool.fn, "function");
    assertStringIncludes(tool.description.toLowerCase(), "file");
    assertEquals("path" in tool.args, true);
    // Arg schema describes the parameter type
    assertEquals(typeof tool.args.path, "string");
  },
});

Deno.test({
  name: "Registry: getTool - each category has working tools",
  fn() {
    // File tools - verify description relates to files
    const readFile = getTool("read_file");
    assertStringIncludes(readFile.description.toLowerCase(), "read");

    // Code tools - verify description relates to code
    const searchCode = getTool("search_code");
    assertStringIncludes(searchCode.description.toLowerCase(), "search");

    // Shell tools - verify description relates to execution
    const shellExec = getTool("shell_exec");
    assertStringIncludes(shellExec.description.toLowerCase(), "command");
  },
});

Deno.test({
  name: "Registry: getTool - throw on invalid tool",
  fn() {
    assertThrows(
      () => {
        getTool("nonexistent_tool");
      },
      Error,
      "not found",
    );
  },
});

Deno.test({
  name: "Registry: getTool - error message lists available tools",
  fn() {
    try {
      getTool("nonexistent_tool");
      throw new Error("Should have thrown");
    } catch (error) {
      assertStringIncludes(
        (error as Error).message,
        "Available tools:",
      );
    }
  },
});

// ============================================================
// getAllTools tests
// ============================================================

Deno.test({
  name: "Registry: getAllTools - return all tools",
  fn() {
    const tools = getAllTools();
    assertEquals(typeof tools, "object");

    // Should have file tools
    assertEquals("read_file" in tools, true);
    assertEquals("write_file" in tools, true);
    assertEquals("open_path" in tools, true);
    assertEquals("archive_files" in tools, true);

    // Should have code tools
    assertEquals("search_code" in tools, true);
    assertEquals("find_symbol" in tools, true);

    // Should have shell tools
    assertEquals("shell_exec" in tools, true);
    assertEquals("shell_script" in tools, true);
  },
});

Deno.test({
  name: "Registry: getAllTools - returns cached reference with same content",
  fn() {
    const tools1 = getAllTools();
    const tools2 = getAllTools();

    // Should be same cached reference (no redundant copies)
    assertEquals(tools1 === tools2, true);

    // Should have consistent content
    assertEquals(
      Object.keys(tools1).length,
      Object.keys(tools2).length,
    );
  },
});

// ============================================================
// getToolsByCategory tests
// ============================================================

Deno.test({
  name: "Registry: getToolsByCategory - categorize tools",
  fn() {
    const categorized = getToolsByCategory();

    // Check structure
    assertEquals(typeof categorized.file, "object");
    assertEquals(typeof categorized.code, "object");
    assertEquals(typeof categorized.shell, "object");

    // Check file tools
    assertEquals(categorized.file.includes("read_file"), true);
    assertEquals(categorized.file.includes("write_file"), true);

    // Check code tools
    assertEquals(categorized.code.includes("search_code"), true);
    assertEquals(categorized.code.includes("find_symbol"), true);

    // Check shell tools
    assertEquals(categorized.shell.includes("shell_exec"), true);
    assertEquals(categorized.shell.includes("shell_script"), true);
  },
});

// ============================================================
// hasTool tests
// ============================================================

Deno.test({
  name: "Registry: hasTool - check valid tool",
  fn() {
    assertEquals(hasTool("read_file"), true);
    assertEquals(hasTool("search_code"), true);
    assertEquals(hasTool("shell_exec"), true);
  },
});

Deno.test({
  name: "Registry: hasTool - check invalid tool",
  fn() {
    assertEquals(hasTool("nonexistent_tool"), false);
    assertEquals(hasTool(""), false);
    assertEquals(hasTool("read_files"), false); // Typo
  },
});

// ============================================================
// validateToolArgs tests
// ============================================================

Deno.test({
  name: "Registry: validateToolArgs - valid args",
  fn() {
    const result = validateToolArgs("read_file", { path: "src/main.ts" });
    assertEquals(result.valid, true);
    assertEquals(result.errors, undefined);
  },
});

Deno.test({
  name: "Registry: validateToolArgs - missing required arg",
  fn() {
    const result = validateToolArgs("read_file", {});
    assertEquals(result.valid, false);
    assertEquals(result.errors !== undefined, true);
    assertEquals(result.errors!.length > 0, true);
    assertStringIncludes(result.errors![0], "Missing required argument");
  },
});

Deno.test({
  name: "Registry: validateToolArgs - unexpected arg",
  fn() {
    const result = validateToolArgs("read_file", {
      path: "src/main.ts",
      unexpected: "value",
    });
    assertEquals(result.valid, false);
    assertEquals(result.errors !== undefined, true);
    assertEquals(
      result.errors!.some((e) => e.includes("Unexpected argument")),
      true,
    );
  },
});

Deno.test({
  name: "Registry: validateToolArgs - args not an object",
  fn() {
    const result1 = validateToolArgs("read_file", "string");
    assertEquals(result1.valid, false);
    assertStringIncludes(result1.errors![0], "must be a plain object");

    const result2 = validateToolArgs("read_file", null);
    assertEquals(result2.valid, false);

    const result3 = validateToolArgs("read_file", ["array"]);
    assertEquals(result3.valid, false);
  },
});

Deno.test({
  name: "Registry: validateToolArgs - optional args allowed",
  fn() {
    // search_code has optional args: path, filePattern, maxResults
    const result = validateToolArgs("search_code", {
      pattern: "test",
      path: "src",
    });
    assertEquals(result.valid, true);
  },
});

Deno.test({
  name: "Registry: validateToolArgs - all optional args",
  fn() {
    // get_structure has all optional args
    const result = validateToolArgs("get_structure", {});
    assertEquals(result.valid, true);
  },
});

// ============================================================
// getToolCount tests
// ============================================================

Deno.test({
  name: "Registry: getToolCount - return correct count",
  fn() {
    const count = getToolCount();

    // Verify count matches getAllTools (single source of truth)
    const tools = getAllTools();
    assertEquals(count, Object.keys(tools).length);
  },
});

// ============================================================
// getToolDescription tests
// ============================================================

Deno.test({
  name: "Registry: getToolDescription - returns meaningful description",
  fn() {
    const desc = getToolDescription("read_file");
    // Description should be a real sentence, not empty or placeholder
    assertStringIncludes(desc.toLowerCase(), "read");
    assertEquals(desc.length >= 10, true); // Real descriptions are at least 10 chars
  },
});

Deno.test({
  name: "Registry: getToolDescription - throw on invalid tool",
  fn() {
    assertThrows(
      () => {
        getToolDescription("nonexistent_tool");
      },
      Error,
      "not found",
    );
  },
});

// ============================================================
// getToolArgSchema tests
// ============================================================

Deno.test({
  name: "Registry: getToolArgSchema - get valid schema",
  fn() {
    const schema = getToolArgSchema("read_file");
    assertEquals(typeof schema, "object");
    assertEquals("path" in schema, true);
  },
});

Deno.test({
  name: "Registry: getToolArgSchema - returns copy not reference",
  fn() {
    const schema1 = getToolArgSchema("read_file");
    const schema2 = getToolArgSchema("read_file");

    // Should be different objects
    assertEquals(schema1 !== schema2, true);

    // But should have same content
    assertEquals(
      Object.keys(schema1).length,
      Object.keys(schema2).length,
    );
  },
});

Deno.test({
  name: "Registry: getToolArgSchema - throw on invalid tool",
  fn() {
    assertThrows(
      () => {
        getToolArgSchema("nonexistent_tool");
      },
      Error,
      "not found",
    );
  },
});

// ============================================================
// registerTool name validation (cross-provider safe)
// ============================================================

Deno.test({
  name: "Registry: registerTool rejects names with dots and slashes",
  fn() {
    const dummyTool = { fn: async () => {}, description: "test", args: {} };
    for (const bad of ["test.invalid", "test/invalid"]) {
      assertThrows(() => registerTool(bad, dummyTool), Error, "Invalid tool name");
    }
  },
});

// ============================================================
// resolveTools tests
// ============================================================

Deno.test({
  name: "Registry: resolveTools applies denylist after allowlist",
  fn() {
    const selected = resolveTools({
      allowlist: ["read_file", "write_file"],
      denylist: ["write_file"],
    });
    assertEquals(Object.keys(selected), ["read_file"]);
  },
});

Deno.test({
  name: "Registry: resolveTools supports allowlist + denylist with dynamic tools",
  fn() {
    registerTool("test_resolve_dynamic", {
      fn: async () => "ok",
      description: "temporary dynamic tool",
      args: {},
    });
    try {
      const selected = resolveTools({
        allowlist: ["test_resolve_dynamic", "read_file"],
        denylist: ["test_resolve_dynamic"],
      });
      assertEquals(Object.keys(selected), ["read_file"]);
    } finally {
      unregisterTool("test_resolve_dynamic");
    }
  },
});

// ============================================================
// searchTools tests
// ============================================================

Deno.test({
  name: "Registry: searchTools ranks matching tools and returns summaries",
  fn() {
    const matches = searchTools("read file", { limit: 5 });
    assertEquals(matches.length > 0, true);
    assertEquals(matches[0].name, "read_file");
    assertStringIncludes(matches[0].description.toLowerCase(), "read");
    assertEquals(matches[0].source, "built-in");
  },
});

Deno.test({
  name: "Registry: searchTools respects denylist filters",
  fn() {
    const matches = searchTools("read file", {
      denylist: ["read_file"],
      limit: 10,
    });
    assertEquals(matches.some((m) => m.name === "read_file"), false);
  },
});
