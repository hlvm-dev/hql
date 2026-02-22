import { assertEquals, assertRejects } from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  inferMcpSafetyLevel,
  loadMcpConfig,
  loadMcpTools,
  resolveBuiltinMcpServers,
} from "../../../src/hlvm/agent/mcp/mod.ts";
import {
  getTool,
  hasTool,
  prepareToolArgsForExecution,
} from "../../../src/hlvm/agent/registry.ts";
import {
  sanitizeToolName,
  validateToolSchema,
} from "../../../src/hlvm/agent/tool-schema.ts";
import { createSdkMcpClient } from "../../../src/hlvm/agent/mcp/sdk-client.ts";

/** Extract text from MCP-compliant tool result: { content: [{ type: "text", text: "..." }] } */
function mcpText(result: unknown): string {
  const r = result as { content: Array<{ type: string; text: string }> };
  return r.content[0].text;
}

Deno.test("loadMcpConfig returns null when missing", async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const config = await loadMcpConfig(temp);
  assertEquals(config, null);
  await platform.fs.remove(temp, { recursive: true });
});

Deno.test({ name: "loadMcpTools registers MCP tools and executes", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const configDir = platform.path.join(temp, ".hlvm");
  await platform.fs.mkdir(configDir, { recursive: true });

  const fixturePath = platform.path.join("tests", "fixtures", "mcp-server.ts");
  const config = {
    version: 1,
    servers: [
      {
        name: "test",
        command: ["deno", "run", fixturePath],
      },
    ],
  };

  const configPath = platform.path.join(configDir, "mcp.json");
  await platform.fs.writeTextFile(configPath, JSON.stringify(config));

  const { tools, dispose } = await loadMcpTools(temp);

  const toolName = "mcp_test_echo";
  assertEquals(hasTool(toolName), true);
  assertEquals(tools.includes(toolName), true);

  const tool = getTool(toolName);
  const result = await tool.fn({ message: "hello" }, temp);
  assertEquals(mcpText(result), "hello");

  await dispose();
  assertEquals(hasTool(toolName), false);

  await platform.fs.remove(temp, { recursive: true });
}});

Deno.test({ name: "loadMcpTools keeps tool registered until all owners dispose", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const configDir = platform.path.join(temp, ".hlvm");
  await platform.fs.mkdir(configDir, { recursive: true });

  const fixturePath = platform.path.join("tests", "fixtures", "mcp-server.ts");
  const config = {
    version: 1,
    servers: [
      {
        name: "test",
        command: ["deno", "run", fixturePath],
      },
    ],
  };

  const configPath = platform.path.join(configDir, "mcp.json");
  await platform.fs.writeTextFile(configPath, JSON.stringify(config));

  const first = await loadMcpTools(temp);
  const second = await loadMcpTools(temp);

  const toolName = "mcp_test_echo";
  assertEquals(hasTool(toolName), true);

  await first.dispose();
  assertEquals(hasTool(toolName), true);

  const tool = getTool(toolName);
  const result = await tool.fn({ message: "still-alive" }, temp);
  assertEquals(mcpText(result), "still-alive");

  await second.dispose();
  assertEquals(hasTool(toolName), false);

  await platform.fs.remove(temp, { recursive: true });
}});

Deno.test({ name: "loadMcpTools routes tool execution by owner/session", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const fixturePath = platform.path.join("tests", "fixtures", "mcp-server.ts");

  const ownerA = "owner-a";
  const ownerB = "owner-b";
  const first = await loadMcpTools(
    temp,
    undefined,
    [{
      name: "test",
      command: ["deno", "run", "--allow-env=MCP_REPLY_PREFIX", fixturePath],
      env: { MCP_REPLY_PREFIX: "A:" },
    }],
    ownerA,
  );
  const second = await loadMcpTools(
    temp,
    undefined,
    [{
      name: "test",
      command: ["deno", "run", "--allow-env=MCP_REPLY_PREFIX", fixturePath],
      env: { MCP_REPLY_PREFIX: "B:" },
    }],
    ownerB,
  );

  const toolName = "mcp_test_echo";
  try {
    const toolA = getTool(toolName, ownerA);
    const toolB = getTool(toolName, ownerB);
    const resultA = await toolA.fn({ message: "hello" }, temp);
    const resultB = await toolB.fn({ message: "hello" }, temp);
    assertEquals(mcpText(resultA), "A:hello");
    assertEquals(mcpText(resultB), "B:hello");

    await first.dispose();
    assertEquals(hasTool(toolName, ownerA), false);
    assertEquals(hasTool(toolName, ownerB), true);

    const stillAlive = await getTool(toolName, ownerB).fn(
      { message: "ok" },
      temp,
    );
    assertEquals(mcpText(stillAlive), "B:ok");
  } finally {
    await first.dispose();
    await second.dispose();
    await platform.fs.remove(temp, { recursive: true });
  }
}});

Deno.test({ name: "MCP tools reject non-object args", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const configDir = platform.path.join(temp, ".hlvm");
  await platform.fs.mkdir(configDir, { recursive: true });

  const fixturePath = platform.path.join("tests", "fixtures", "mcp-server.ts");
  const config = {
    version: 1,
    servers: [
      {
        name: "test",
        command: ["deno", "run", fixturePath],
      },
    ],
  };

  const configPath = platform.path.join(configDir, "mcp.json");
  await platform.fs.writeTextFile(configPath, JSON.stringify(config));

  const { dispose } = await loadMcpTools(temp);
  const tool = getTool("mcp_test_echo");

  await assertRejects(
    () => tool.fn("bad" as unknown as Record<string, unknown>, temp),
  );

  await dispose();
  await platform.fs.remove(temp, { recursive: true });
}});

Deno.test({ name: "MCP tools honor optional args from inputSchema required list", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const configDir = platform.path.join(temp, ".hlvm");
  await platform.fs.mkdir(configDir, { recursive: true });

  const fixturePath = platform.path.join("tests", "fixtures", "mcp-server.ts");
  const config = {
    version: 1,
    servers: [
      {
        name: "test",
        command: ["deno", "run", fixturePath],
      },
    ],
  };

  const configPath = platform.path.join(configDir, "mcp.json");
  await platform.fs.writeTextFile(configPath, JSON.stringify(config));

  const { dispose } = await loadMcpTools(temp);
  const validation = prepareToolArgsForExecution("mcp_test_echo", {});
  assertEquals(validation.validation.valid, true);

  await dispose();
  await platform.fs.remove(temp, { recursive: true });
}});

Deno.test({ name: "loadMcpTools continues when one server fails", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const fixturePath = platform.path.join("tests", "fixtures", "mcp-server.ts");

  const { tools, dispose } = await loadMcpTools(
    temp,
    undefined,
    [
      { name: "broken", command: ["definitely-not-a-real-command"] },
      { name: "test", command: ["deno", "run", fixturePath] },
    ],
  );

  const toolName = "mcp_test_echo";
  assertEquals(tools.includes(toolName), true);
  assertEquals(hasTool(toolName), true);

  await dispose();
  assertEquals(hasTool(toolName), false);
  await platform.fs.remove(temp, { recursive: true });
}});

Deno.test({ name: "loadMcpTools deduplicates server names (config takes precedence)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const configDir = platform.path.join(temp, ".hlvm");
  await platform.fs.mkdir(configDir, { recursive: true });

  const fixturePath = platform.path.join("tests", "fixtures", "mcp-server.ts");
  const config = {
    version: 1,
    servers: [
      {
        name: "test",
        command: ["deno", "run", fixturePath],
      },
    ],
  };

  const configPath = platform.path.join(configDir, "mcp.json");
  await platform.fs.writeTextFile(configPath, JSON.stringify(config));

  const { tools, dispose } = await loadMcpTools(
    temp,
    undefined,
    [{ name: "test", command: ["definitely-not-a-real-command"] }],
  );

  assertEquals(tools.includes("mcp_test_echo"), true);
  await dispose();
  await platform.fs.remove(temp, { recursive: true });
}});

Deno.test({ name: "resolveBuiltinMcpServers returns playwright server only when script exists", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const platform = getPlatform();

  const repoServers = await resolveBuiltinMcpServers(platform.process.cwd());
  assertEquals(repoServers[0]?.name, "playwright");
  assertEquals(Array.isArray(repoServers[0]?.command), true);

  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const tempServers = await resolveBuiltinMcpServers(temp);
  assertEquals(tempServers.length, 0);
  await platform.fs.remove(temp, { recursive: true });
}});

Deno.test("inferMcpSafetyLevel classifies read and mutating tool names", () => {
  assertEquals(inferMcpSafetyLevel("render_url"), "L0");
  assertEquals(inferMcpSafetyLevel("search_documents"), "L0");
  assertEquals(inferMcpSafetyLevel("echo"), "L0");
  assertEquals(inferMcpSafetyLevel("click_button"), "L2");
  assertEquals(inferMcpSafetyLevel("delete_record"), "L2");
  assertEquals(inferMcpSafetyLevel("run_script"), "L2");
  assertEquals(inferMcpSafetyLevel("custom_tool_without_hint"), "L1");
});

// ============================================================
// Phase 2: Resources + Prompts as Tools
// ============================================================

Deno.test({ name: "loadMcpTools registers resource tools when server has capability", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const fixturePath = platform.path.join("tests", "fixtures", "mcp-server.ts");

  const { tools, dispose } = await loadMcpTools(
    temp,
    undefined,
    [{
      name: "restest",
      command: [
        "deno",
        "run",
        "--allow-env=MCP_TEST_MODE",
        fixturePath,
      ],
      env: { MCP_TEST_MODE: "resources" },
    }],
  );

  // Should have echo tool + resource tools
  assertEquals(tools.includes("mcp_restest_echo"), true);
  assertEquals(tools.includes("mcp_restest_list_resources"), true);
  assertEquals(tools.includes("mcp_restest_read_resource"), true);

  // Execute list_resources
  const listTool = getTool("mcp_restest_list_resources");
  const listResult = await listTool.fn({}, temp) as {
    resources: Array<{ uri: string; name: string }>;
  };
  assertEquals(Array.isArray(listResult.resources), true);
  assertEquals(listResult.resources.length, 2);
  assertEquals(listResult.resources[0].uri, "file:///test/readme.md");

  // Execute read_resource
  const readTool = getTool("mcp_restest_read_resource");
  const readResult = await readTool.fn(
    { uri: "file:///test/readme.md" },
    temp,
  ) as { contents: Array<{ uri: string; text: string }> };
  assertEquals(readResult.contents.length, 1);
  assertEquals(
    readResult.contents[0].text,
    "# Test README\nThis is a test resource.",
  );

  await dispose();
  await platform.fs.remove(temp, { recursive: true });
}});

Deno.test({ name: "loadMcpTools registers prompt tools when server has capability", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const fixturePath = platform.path.join("tests", "fixtures", "mcp-server.ts");

  const { tools, dispose } = await loadMcpTools(
    temp,
    undefined,
    [{
      name: "ptest",
      command: [
        "deno",
        "run",
        "--allow-env=MCP_TEST_MODE",
        fixturePath,
      ],
      env: { MCP_TEST_MODE: "prompts" },
    }],
  );

  assertEquals(tools.includes("mcp_ptest_echo"), true);
  assertEquals(tools.includes("mcp_ptest_list_prompts"), true);
  assertEquals(tools.includes("mcp_ptest_get_prompt"), true);

  // Execute list_prompts
  const listTool = getTool("mcp_ptest_list_prompts");
  const listResult = await listTool.fn({}, temp) as {
    prompts: Array<{ name: string }>;
  };
  assertEquals(Array.isArray(listResult.prompts), true);
  assertEquals(listResult.prompts.length, 2);
  assertEquals(listResult.prompts[0].name, "greeting");

  // Execute get_prompt
  const getTool2 = getTool("mcp_ptest_get_prompt");
  const getResult = await getTool2.fn(
    { name: "greeting", "name:unused": undefined as unknown as string },
    temp,
  ) as { messages: string };
  assertEquals(typeof getResult.messages, "string");
  assertEquals(getResult.messages.includes("greet"), true);

  await dispose();
  await platform.fs.remove(temp, { recursive: true });
}});

Deno.test({ name: "loadMcpTools does NOT register resource/prompt tools when server lacks capability", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const fixturePath = platform.path.join("tests", "fixtures", "mcp-server.ts");

  // No MCP_TEST_MODE = no resources/prompts capabilities
  const { tools, dispose } = await loadMcpTools(
    temp,
    undefined,
    [{
      name: "plain",
      command: ["deno", "run", fixturePath],
    }],
  );

  assertEquals(tools.includes("mcp_plain_echo"), true);
  assertEquals(tools.includes("mcp_plain_list_resources"), false);
  assertEquals(tools.includes("mcp_plain_read_resource"), false);
  assertEquals(tools.includes("mcp_plain_list_prompts"), false);
  assertEquals(tools.includes("mcp_plain_get_prompt"), false);

  await dispose();
  await platform.fs.remove(temp, { recursive: true });
}});

Deno.test({ name: "McpLoadResult.setHandlers is a no-op when empty", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const fixturePath = platform.path.join("tests", "fixtures", "mcp-server.ts");

  const result = await loadMcpTools(
    temp,
    undefined,
    [{ name: "test", command: ["deno", "run", fixturePath] }],
  );

  // setHandlers should be callable without error
  result.setHandlers({});
  result.setHandlers({ roots: ["file:///workspace"] });

  await result.dispose();
  await platform.fs.remove(temp, { recursive: true });
}});

// ============================================================
// sanitizeToolName & validateToolSchema (SSOT for all providers)
// ============================================================

Deno.test("sanitizeToolName: cross-provider safe (dots, slashes, length, leading letter)", () => {
  // Replaces invalid chars
  assertEquals(sanitizeToolName("mcp_server.name/tool"), "mcp_server_name_tool");
  // Truncates to 64 (OpenAI + Anthropic max)
  const longName = "a" + "_x".repeat(80);
  assertEquals(sanitizeToolName(longName).length, 64);
  // Ensures leading letter when name starts with non-letter
  assertEquals(/^[a-zA-Z]/.test(sanitizeToolName("123_tool")), true);
  assertEquals(/^[a-zA-Z]/.test(sanitizeToolName("_tool")), true);
});

Deno.test("validateToolSchema: warns on unknown types, clean for valid", () => {
  const badTool = { fn: async () => {}, description: "test", args: { x: "banana - weird" } };
  assertEquals(validateToolSchema("t", badTool).length, 1);

  const goodTool = { fn: async () => {}, description: "test", args: { a: "string - ok", b: "number (optional) - ok" } };
  assertEquals(validateToolSchema("t", goodTool).length, 0);
});

// ============================================================
// Integration Tests — Real Fixture Server
// ============================================================

// NOTE: Paginated tools/list and protocol version fallback tests removed —
// these tested hand-rolled client features. The SDK handles protocol negotiation
// internally and doesn't expose cursor-based pagination via client.listTools().

Deno.test({ name: "Integration: completion/complete via SDK client", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const fixturePath = getPlatform().path.join("tests", "fixtures", "mcp-server.ts");
  const server = { name: "comp", command: ["deno", "run", fixturePath] };
  const client = await createSdkMcpClient(server);

  const values = await client.complete(
    { type: "ref/prompt", name: "greeting" },
    { name: "name", value: "test" },
  );

  assertEquals(values.length, 2);
  assertEquals(values[0], "testcompletion1");
  assertEquals(values[1], "testcompletion2");

  await client.close();
}});

Deno.test({ name: "Integration: ping round-trip via SDK client", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const fixturePath = getPlatform().path.join("tests", "fixtures", "mcp-server.ts");
  const server = { name: "pingtest", command: ["deno", "run", fixturePath] };
  const client = await createSdkMcpClient(server);

  // Ping should resolve without error
  await client.ping();

  await client.close();
}});

Deno.test({ name: "Integration: logging setLevel + notification via SDK client", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const fixturePath = getPlatform().path.join("tests", "fixtures", "mcp-server.ts");
  const server = {
    name: "logtest",
    command: [
      "deno",
      "run",
      "--allow-env=MCP_TEST_MODE",
      fixturePath,
    ],
    env: { MCP_TEST_MODE: "logging" },
  };
  const client = await createSdkMcpClient(server);

  // Track logging notification
  let logMessage = "";
  client.onNotification("notifications/message", (params: unknown) => {
    const p = params as Record<string, unknown>;
    logMessage = typeof p.data === "string" ? p.data : "";
  });

  await client.setLogLevel("debug");

  // Wait briefly for the notification to arrive
  await new Promise((r) => setTimeout(r, 100));
  assertEquals(logMessage, "Log level set");

  await client.close();
}});

Deno.test({ name: "Integration: sampling round-trip via setHandlers", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const fixturePath = platform.path.join("tests", "fixtures", "mcp-server.ts");

  const result = await loadMcpTools(
    temp,
    undefined,
    [{
      name: "samp",
      command: [
        "deno",
        "run",
        "--allow-env=MCP_TEST_MODE",
        fixturePath,
      ],
      env: { MCP_TEST_MODE: "sampling" },
    }],
  );

  // Wire sampling handler
  let samplingCalled = false;
  let samplingRequest: unknown = null;
  result.setHandlers({
    onSampling: async (req) => {
      samplingCalled = true;
      samplingRequest = req;
      return {
        role: "assistant" as const,
        content: { type: "text" as const, text: "The answer is 4" },
        model: "test-model",
      };
    },
  });

  // The fixture server sends sampling/createMessage 50ms after initialize.
  // Under heavy load (full test suite), the subprocess may be slow to start.
  // Poll with retries instead of fixed wait (up to 15s).
  for (let i = 0; i < 150 && !samplingCalled; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assertEquals(samplingCalled, true);
  const req = samplingRequest as Record<string, unknown>;
  assertEquals(Array.isArray(req.messages), true);

  await result.dispose();
  await platform.fs.remove(temp, { recursive: true });
}});

Deno.test({ name: "Integration: elicitation round-trip via setHandlers", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const fixturePath = platform.path.join("tests", "fixtures", "mcp-server.ts");

  const result = await loadMcpTools(
    temp,
    undefined,
    [{
      name: "elicit",
      command: [
        "deno",
        "run",
        "--allow-env=MCP_TEST_MODE",
        fixturePath,
      ],
      env: { MCP_TEST_MODE: "elicitation" },
    }],
  );

  // Wire elicitation handler
  let elicitationCalled = false;
  let elicitationMessage = "";
  result.setHandlers({
    onElicitation: async (req) => {
      elicitationCalled = true;
      elicitationMessage = req.message;
      return {
        action: "accept" as const,
        content: { confirmed: true },
      };
    },
  });

  // The fixture server sends elicitation/create 50ms after initialize.
  // Under heavy load (full test suite), the subprocess may be slow to start.
  // Poll with retries instead of fixed wait (up to 15s).
  for (let i = 0; i < 150 && !elicitationCalled; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assertEquals(elicitationCalled, true);
  assertEquals(elicitationMessage, "Please confirm deployment");

  await result.dispose();
  await platform.fs.remove(temp, { recursive: true });
}});

Deno.test({ name: "Integration: setSignal cancels pending on abort", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const fixturePath = platform.path.join("tests", "fixtures", "mcp-server.ts");

  const result = await loadMcpTools(
    temp,
    undefined,
    [{
      name: "canceltest",
      command: ["deno", "run", fixturePath],
    }],
  );

  const controller = new AbortController();
  result.setSignal(controller.signal);

  // Abort the signal — should cancel pending requests (no error expected)
  controller.abort();

  // Just verify no crash — setSignal + abort is a fire-and-forget pattern
  await result.dispose();
  await platform.fs.remove(temp, { recursive: true });
}});

Deno.test({ name: "Integration: resource subscribe and unsubscribe via SDK client", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const fixturePath = getPlatform().path.join("tests", "fixtures", "mcp-server.ts");
  const server = {
    name: "subtest",
    command: [
      "deno",
      "run",
      "--allow-env=MCP_TEST_MODE",
      fixturePath,
    ],
    env: { MCP_TEST_MODE: "resources" },
  };
  const client = await createSdkMcpClient(server);

  // Both should resolve without error (server returns {})
  await client.subscribeResource("file:///test/readme.md");
  await client.unsubscribeResource("file:///test/readme.md");

  await client.close();
}});
