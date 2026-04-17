import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert";
import type { ToolMetadata } from "../../../src/hlvm/agent/registry.ts";
import {
  getAllTools,
  getTool,
  getToolArgSchema,
  getToolCount,
  getToolDescription,
  getToolsByCategory,
  hasTool,
  normalizeToolName,
  prepareToolArgsForExecution,
  registerTool,
  registerTools,
  releaseToolOwner,
  resolveTools,
  searchTools,
  suggestToolNames,
  unregisterTool,
  validateToolArgs,
} from "../../../src/hlvm/agent/registry.ts";

function withRegisteredTool(
  name: string,
  tool: ToolMetadata,
  fn: () => void,
): void {
  registerTool(name, tool);
  try {
    fn();
  } finally {
    unregisterTool(name);
  }
}

Deno.test("Registry: built-ins expose consistent lookup metadata", () => {
  const tool = getTool("read_file");
  const schema1 = getToolArgSchema("read_file");
  const schema2 = getToolArgSchema("read_file");

  assertEquals(typeof tool.fn, "function");
  assertStringIncludes(getToolDescription("read_file").toLowerCase(), "read");
  assertEquals("path" in schema1, true);
  assertEquals(schema1 === schema2, false);
});

Deno.test("Registry: cached registry view stays aligned with category and count helpers", () => {
  const tools1 = getAllTools();
  const tools2 = getAllTools();
  const categories = getToolsByCategory();

  assertEquals(tools1 === tools2, true);
  assertEquals(getToolCount(), Object.keys(tools1).length);
  assertEquals(hasTool("read_file"), true);
  assertEquals(hasTool("nonexistent_tool"), false);
  assertEquals(categories.file.includes("read_file"), true);
  assertEquals(categories.code.includes("search_code"), true);
  assertEquals(categories.shell.includes("shell_exec"), true);
});

Deno.test("Registry: unknown lookup errors list available tools", () => {
  assertThrows(
    () => getTool("nonexistent_tool"),
    Error,
    "Available tools:",
  );
});

Deno.test("Registry: validateToolArgs accepts canonical inputs and rejects invalid shapes", () => {
  assertEquals(
    validateToolArgs("read_file", { path: "src/main.ts" }).valid,
    true,
  );
  assertEquals(
    validateToolArgs("search_code", { pattern: "test", path: "src" }).valid,
    true,
  );
  assertEquals(validateToolArgs("get_structure", {}).valid, true);

  const missing = validateToolArgs("read_file", {});
  assertEquals(missing.valid, false);
  assertStringIncludes(
    missing.errors?.[0] ?? "",
    "Missing required argument 'path'",
  );
  assertStringIncludes(
    missing.message ?? "",
    "Missing required argument 'path'",
  );

  const unexpected = validateToolArgs("read_file", {
    path: "src/main.ts",
    unexpected: true,
  });
  assertEquals(unexpected.valid, false);
  assertEquals(
    unexpected.errors?.some((error) => error.includes("Unexpected argument")),
    true,
  );

  const nonObject = validateToolArgs("read_file", null);
  assertEquals(nonObject.valid, false);
  assertStringIncludes(nonObject.errors?.[0] ?? "", "object with named fields");
});

Deno.test("Registry: web arg aliases normalize before coercion/validation and canonical args win", () => {
  const aliased = prepareToolArgsForExecution("search_web", {
    query: "hlvm",
    recency: "week",
    preFetch: "false",
    search_depth: "high",
  });
  assertEquals(aliased.validation.valid, true);
  assertEquals(aliased.coercedArgs, {
    query: "hlvm",
    timeRange: "week",
    prefetch: false,
    searchDepth: "high",
  });

  const canonicalWins = prepareToolArgsForExecution("search_web", {
    query: "hlvm",
    timeRange: "month",
    recency: "week",
    prefetch: true,
    preFetch: false,
  });
  assertEquals(canonicalWins.validation.valid, true);
  assertEquals(canonicalWins.coercedArgs, {
    query: "hlvm",
    timeRange: "month",
    prefetch: true,
  });
});

Deno.test("Registry: name normalization and suggestions map user variants to canonical tools", () => {
  assertEquals(normalizeToolName("Read_File"), "read_file");
  assertEquals(normalizeToolName("listFiles"), "list_files");
  assertEquals(normalizeToolName("list-files"), "list_files");
  assertEquals(normalizeToolName("totally_missing"), null);
  assertEquals(suggestToolNames("readFile").includes("read_file"), true);
});

Deno.test("Registry: registerTool rejects provider-unsafe names", () => {
  const dummyTool: ToolMetadata = {
    fn: async () => undefined,
    description: "temporary test tool",
    args: {},
  };

  for (const badName of ["test.invalid", "test/invalid", "1bad_name"]) {
    assertThrows(
      () => registerTool(badName, dummyTool),
      Error,
      "Invalid tool name",
    );
  }
});

Deno.test("Registry: dynamic tools participate in selection and search", () => {
  withRegisteredTool("test_dynamic_registry", {
    fn: async () => ({ ok: true }),
    description: "Temporary dynamic helper for registry search testing",
    args: { query: "string - Query text" },
    category: "meta",
    safetyLevel: "L0",
  }, () => {
    assertEquals(hasTool("test_dynamic_registry"), true);

    const selected = resolveTools({
      allowlist: ["read_file", "test_dynamic_registry"],
      denylist: ["test_dynamic_registry"],
    });
    assertEquals(Object.keys(selected), ["read_file"]);

    const dynamicMatches = searchTools("dynamic helper", {
      allowlist: ["test_dynamic_registry"],
      limit: 5,
    });
    assertEquals(dynamicMatches[0]?.name, "test_dynamic_registry");
    assertEquals(dynamicMatches[0]?.source, "dynamic");

    const builtInMatches = searchTools("read file", {
      denylist: ["read_file"],
      limit: 10,
    });
    assertEquals(
      builtInMatches.some((match) => match.name === "read_file"),
      false,
    );
  });

  assertEquals(hasTool("test_dynamic_registry"), false);
});

Deno.test("Registry: explicit empty allowlist exposes no tools", () => {
  const selected = resolveTools({ allowlist: [] });

  assertEquals(Object.keys(selected), []);
});

Deno.test("Registry: releaseToolOwner clears owner-scoped caches and dynamic tools", () => {
  const ownerId = "session:test-owner";
  registerTools({
    test_owner_scoped_tool: {
      fn: async () => ({ ok: true }),
      description: "Owner-scoped registry entry",
      args: {},
      category: "meta",
      safetyLevel: "L0",
    },
  }, ownerId);

  try {
    const cached = getAllTools(ownerId);
    assertEquals("test_owner_scoped_tool" in cached, true);
    assertEquals(hasTool("test_owner_scoped_tool", ownerId), true);

    releaseToolOwner(ownerId);

    const afterRelease = getAllTools(ownerId);
    assertEquals("test_owner_scoped_tool" in afterRelease, false);
    assertEquals(hasTool("test_owner_scoped_tool", ownerId), false);
    assertEquals(hasTool("test_owner_scoped_tool"), false);
  } finally {
    unregisterTool("test_owner_scoped_tool", ownerId);
  }
});
