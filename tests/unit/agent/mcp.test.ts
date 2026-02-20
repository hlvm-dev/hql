import { assertEquals, assertRejects } from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  inferMcpSafetyLevel,
  loadMcpConfig,
  loadMcpTools,
  resolveBuiltinMcpServers,
} from "../../../src/hlvm/agent/mcp.ts";
import {
  getTool,
  hasTool,
  prepareToolArgsForExecution,
} from "../../../src/hlvm/agent/registry.ts";
import {
  sanitizeToolName,
  validateToolSchema,
} from "../../../src/hlvm/agent/tool-schema.ts";

Deno.test("loadMcpConfig returns null when missing", async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const config = await loadMcpConfig(temp);
  assertEquals(config, null);
  await platform.fs.remove(temp, { recursive: true });
});

Deno.test("loadMcpTools registers MCP tools and executes", async () => {
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
  assertEquals((result as { content: string }).content, "hello");

  await dispose();
  assertEquals(hasTool(toolName), false);

  await platform.fs.remove(temp, { recursive: true });
});

Deno.test("loadMcpTools keeps tool registered until all owners dispose", async () => {
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
  assertEquals((result as { content: string }).content, "still-alive");

  await second.dispose();
  assertEquals(hasTool(toolName), false);

  await platform.fs.remove(temp, { recursive: true });
});

Deno.test("loadMcpTools routes tool execution by owner/session", async () => {
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
    assertEquals((resultA as { content: string }).content, "A:hello");
    assertEquals((resultB as { content: string }).content, "B:hello");

    await first.dispose();
    assertEquals(hasTool(toolName, ownerA), false);
    assertEquals(hasTool(toolName, ownerB), true);

    const stillAlive = await getTool(toolName, ownerB).fn(
      { message: "ok" },
      temp,
    );
    assertEquals((stillAlive as { content: string }).content, "B:ok");
  } finally {
    await first.dispose();
    await second.dispose();
    await platform.fs.remove(temp, { recursive: true });
  }
});

Deno.test("MCP tools reject non-object args", async () => {
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
});

Deno.test("MCP tools honor optional args from inputSchema required list", async () => {
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
});

Deno.test("loadMcpTools continues when one server fails", async () => {
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
});

Deno.test("loadMcpTools deduplicates server names (config takes precedence)", async () => {
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
});

Deno.test("resolveBuiltinMcpServers returns playwright server only when script exists", async () => {
  const platform = getPlatform();

  const repoServers = await resolveBuiltinMcpServers(platform.process.cwd());
  assertEquals(repoServers[0]?.name, "playwright");
  assertEquals(Array.isArray(repoServers[0]?.command), true);

  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const tempServers = await resolveBuiltinMcpServers(temp);
  assertEquals(tempServers.length, 0);
  await platform.fs.remove(temp, { recursive: true });
});

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

Deno.test("loadMcpTools registers resource tools when server has capability", async () => {
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
});

Deno.test("loadMcpTools registers prompt tools when server has capability", async () => {
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
});

Deno.test("loadMcpTools does NOT register resource/prompt tools when server lacks capability", async () => {
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
});

Deno.test("McpLoadResult.setHandlers is a no-op when empty", async () => {
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
});

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
// MockTransport — for deterministic McpClient unit tests
// ============================================================

import { McpClient } from "../../../src/hlvm/agent/mcp/client.ts";
import type { JsonRpcMessage, McpTransport } from "../../../src/hlvm/agent/mcp/types.ts";

/** In-memory transport that lets tests inject server messages */
class MockTransport implements McpTransport {
  private handler: ((message: JsonRpcMessage) => void) | null = null;
  /** All messages sent by the client → inspectable by tests */
  readonly sent: JsonRpcMessage[] = [];
  /** Pending response resolvers keyed by method name */
  private autoResponders = new Map<
    string,
    (msg: JsonRpcMessage) => JsonRpcMessage | null
  >();

  setMessageHandler(handler: (message: JsonRpcMessage) => void): void {
    this.handler = handler;
  }
  async start(): Promise<void> {}
  async send(message: JsonRpcMessage): Promise<void> {
    this.sent.push(message);
    // Check auto-responders
    if (message.method) {
      const responder = this.autoResponders.get(message.method);
      if (responder) {
        const response = responder(message);
        if (response && this.handler) {
          // Async dispatch to simulate real transport
          queueMicrotask(() => this.handler!(response));
        }
      }
    }
  }
  async close(): Promise<void> {}

  /** Inject a message as if it came from the server */
  injectMessage(msg: JsonRpcMessage): void {
    if (this.handler) this.handler(msg);
  }

  /** Auto-respond to a method with a result */
  onMethod(
    method: string,
    fn: (msg: JsonRpcMessage) => JsonRpcMessage | null,
  ): void {
    this.autoResponders.set(method, fn);
  }

  /** Set up basic initialize + initialized auto-respond */
  setupInitialize(
    capabilities: Record<string, unknown> = { tools: {} },
    version = "2025-11-25",
  ): void {
    this.onMethod("initialize", (msg) => ({
      jsonrpc: "2.0",
      id: msg.id!,
      result: {
        protocolVersion: version,
        serverInfo: { name: "mock", version: "0.1" },
        capabilities,
      },
    }));
  }
}

function createMockClient(
  capabilities?: Record<string, unknown>,
): { client: McpClient; transport: MockTransport } {
  const transport = new MockTransport();
  transport.setupInitialize(capabilities);
  const client = new McpClient(
    { name: "mock", command: ["mock"] },
    transport,
  );
  return { client, transport };
}

// ============================================================
// McpClient Unit Tests via MockTransport
// ============================================================

Deno.test("McpClient: 3-way routing — response resolves pending request", async () => {
  const { client, transport } = createMockClient();

  // Set up auto-respond for ping
  transport.onMethod("ping", (msg) => ({
    jsonrpc: "2.0",
    id: msg.id!,
    result: {},
  }));

  await client.start();
  // ping should resolve without error
  await client.ping();

  await client.close();
});

Deno.test("McpClient: 3-way routing — server notification dispatched to handler", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  let notificationReceived = false;
  let notificationParams: unknown = null;
  client.onNotification("notifications/progress", (params) => {
    notificationReceived = true;
    notificationParams = params;
  });

  // Inject a notification (has method, no id)
  transport.injectMessage({
    jsonrpc: "2.0",
    method: "notifications/progress",
    params: { progressToken: "t1", progress: 42, total: 100 },
  });

  assertEquals(notificationReceived, true);
  assertEquals(
    (notificationParams as Record<string, unknown>).progress,
    42,
  );

  await client.close();
});

Deno.test("McpClient: 3-way routing — server request dispatched to handler and response sent", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  // Register a handler for sampling
  client.onRequest("sampling/createMessage", async (params) => {
    const p = params as Record<string, unknown>;
    return {
      role: "assistant",
      content: { type: "text", text: "Answer: 4" },
      model: "test-model",
    };
  });

  // Inject a server-initiated request (has both method AND id)
  transport.injectMessage({
    jsonrpc: "2.0",
    id: 9999,
    method: "sampling/createMessage",
    params: {
      messages: [{ role: "user", content: { type: "text", text: "2+2?" } }],
      maxTokens: 100,
    },
  });

  // Wait for async handler to complete
  await new Promise((r) => setTimeout(r, 50));

  // Client should have sent a response with id 9999
  const response = transport.sent.find(
    (m) => m.id === 9999 && m.result !== undefined,
  );
  assertEquals(response !== undefined, true);
  const result = response!.result as Record<string, unknown>;
  assertEquals(result.model, "test-model");
  assertEquals(
    (result.content as Record<string, unknown>).text,
    "Answer: 4",
  );

  await client.close();
});

Deno.test("McpClient: 3-way routing — unknown server request gets -32601 error", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  // Inject a server request for an unregistered method
  transport.injectMessage({
    jsonrpc: "2.0",
    id: 8888,
    method: "unknown/method",
    params: {},
  });

  await new Promise((r) => setTimeout(r, 50));

  const errorResponse = transport.sent.find(
    (m) => m.id === 8888 && m.error !== undefined,
  );
  assertEquals(errorResponse !== undefined, true);
  const err = errorResponse!.error as { code: number; message: string };
  assertEquals(err.code, -32601);

  await client.close();
});

Deno.test("McpClient: hasCapability reflects server capabilities", async () => {
  const { client } = createMockClient({
    tools: {},
    resources: { subscribe: true },
    prompts: {},
  });
  await client.start();

  assertEquals(client.hasCapability("tools"), true);
  assertEquals(client.hasCapability("resources"), true);
  assertEquals(client.hasCapability("prompts"), true);
  assertEquals(client.hasCapability("logging"), false);
  assertEquals(client.hasCapability("nonexistent"), false);

  await client.close();
});

Deno.test("McpClient: pagination collects all pages", async () => {
  const { client, transport } = createMockClient();

  // Auto-respond tools/list with pagination
  transport.onMethod("tools/list", (msg) => {
    const params = msg.params as Record<string, unknown> | undefined;
    const cursor = params?.cursor as string | undefined;
    if (!cursor) {
      return {
        jsonrpc: "2.0",
        id: msg.id!,
        result: {
          tools: [{ name: "tool_a", description: "A" }],
          nextCursor: "page2",
        },
      };
    }
    if (cursor === "page2") {
      return {
        jsonrpc: "2.0",
        id: msg.id!,
        result: {
          tools: [{ name: "tool_b", description: "B" }],
          nextCursor: "page3",
        },
      };
    }
    return {
      jsonrpc: "2.0",
      id: msg.id!,
      result: {
        tools: [{ name: "tool_c", description: "C" }],
      },
    };
  });

  await client.start();
  const tools = await client.listTools();
  assertEquals(tools.length, 3);
  assertEquals(tools[0].name, "tool_a");
  assertEquals(tools[1].name, "tool_b");
  assertEquals(tools[2].name, "tool_c");

  await client.close();
});

Deno.test("McpClient: completion returns values", async () => {
  const { client, transport } = createMockClient();
  transport.onMethod("completion/complete", (msg) => ({
    jsonrpc: "2.0",
    id: msg.id!,
    result: {
      completion: {
        values: ["val1", "val2"],
        hasMore: false,
        total: 2,
      },
    },
  }));

  await client.start();
  const values = await client.complete(
    { type: "ref/prompt", name: "test" },
    { name: "arg", value: "v" },
  );
  assertEquals(values, ["val1", "val2"]);

  await client.close();
});

Deno.test("McpClient: cancelAllPending sends cancellation for all pending requests", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  // Create 2 pending requests that won't resolve
  const p1 = client.request("slow/op1", {}).catch(() => {});
  const p2 = client.request("slow/op2", {}).catch(() => {});

  // Should have 2 pending request IDs (after init which already resolved)
  const pendingIds = client.getPendingRequestIds();
  assertEquals(pendingIds.length >= 2, true);

  // Cancel all
  client.cancelAllPending("test abort");

  // Should have sent notifications/cancelled for each pending
  const cancellations = transport.sent.filter(
    (m) => m.method === "notifications/cancelled",
  );
  assertEquals(cancellations.length >= 2, true);

  // Clean up — close will fail pending that weren't resolved
  await client.close();
  await Promise.allSettled([p1, p2]);
});

Deno.test("McpClient: setLogLevel sends logging/setLevel", async () => {
  const { client, transport } = createMockClient({ logging: {} });
  transport.onMethod("logging/setLevel", (msg) => ({
    jsonrpc: "2.0",
    id: msg.id!,
    result: {},
  }));

  await client.start();
  await client.setLogLevel("debug");

  const sent = transport.sent.find(
    (m) => m.method === "logging/setLevel",
  );
  assertEquals(sent !== undefined, true);
  assertEquals((sent!.params as Record<string, unknown>).level, "debug");

  await client.close();
});

Deno.test("McpClient: subscribeResource and unsubscribeResource", async () => {
  const { client, transport } = createMockClient({
    resources: { subscribe: true },
  });
  transport.onMethod("resources/subscribe", (msg) => ({
    jsonrpc: "2.0",
    id: msg.id!,
    result: {},
  }));
  transport.onMethod("resources/unsubscribe", (msg) => ({
    jsonrpc: "2.0",
    id: msg.id!,
    result: {},
  }));

  await client.start();
  await client.subscribeResource("file:///test/readme.md");
  await client.unsubscribeResource("file:///test/readme.md");

  const sub = transport.sent.find(
    (m) => m.method === "resources/subscribe",
  );
  const unsub = transport.sent.find(
    (m) => m.method === "resources/unsubscribe",
  );
  assertEquals(sub !== undefined, true);
  assertEquals(unsub !== undefined, true);
  assertEquals(
    (sub!.params as Record<string, unknown>).uri,
    "file:///test/readme.md",
  );

  await client.close();
});

Deno.test("McpClient: error response rejects pending request", async () => {
  const { client, transport } = createMockClient();
  transport.onMethod("tools/call", (msg) => ({
    jsonrpc: "2.0",
    id: msg.id!,
    error: { code: -32602, message: "Invalid params" },
  }));

  await client.start();
  let caught = false;
  try {
    await client.callTool("bad_tool", {});
  } catch (e) {
    caught = true;
    assertEquals((e as Error).message.includes("Invalid params"), true);
  }
  assertEquals(caught, true);

  await client.close();
});

// ============================================================
// Integration Tests — Real Fixture Server
// ============================================================

Deno.test("Integration: paginated tools/list collects both pages", async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const fixturePath = platform.path.join("tests", "fixtures", "mcp-server.ts");

  const { tools, dispose } = await loadMcpTools(
    temp,
    undefined,
    [{
      name: "paged",
      command: [
        "deno",
        "run",
        "--allow-env=MCP_TEST_MODE",
        fixturePath,
      ],
      env: { MCP_TEST_MODE: "paginated" },
    }],
  );

  // paginated mode returns "echo" (page 1) and "reverse" (page 2)
  assertEquals(tools.includes("mcp_paged_echo"), true);
  assertEquals(tools.includes("mcp_paged_reverse"), true);

  // Verify reverse tool actually works
  const reverseTool = getTool("mcp_paged_reverse");
  const result = await reverseTool.fn({ text: "hello" }, temp);
  assertEquals((result as { content: string }).content, "olleh");

  await dispose();
  await platform.fs.remove(temp, { recursive: true });
});

Deno.test("Integration: protocol version fallback (old_protocol mode)", async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const fixturePath = platform.path.join("tests", "fixtures", "mcp-server.ts");

  // old_protocol rejects 2025-11-25, accepts 2024-11-05
  const { tools, dispose } = await loadMcpTools(
    temp,
    undefined,
    [{
      name: "oldproto",
      command: [
        "deno",
        "run",
        "--allow-env=MCP_TEST_MODE",
        fixturePath,
      ],
      env: { MCP_TEST_MODE: "old_protocol" },
    }],
  );

  // Tools should still be registered (client fell back to 2024-11-05)
  assertEquals(tools.includes("mcp_oldproto_echo"), true);

  // Tool should still work
  const tool = getTool("mcp_oldproto_echo");
  const result = await tool.fn({ message: "fallback works" }, temp);
  assertEquals(
    (result as { content: string }).content,
    "fallback works",
  );

  await dispose();
  await platform.fs.remove(temp, { recursive: true });
});

Deno.test("Integration: completion/complete via fixture server", async () => {
  const platform = getPlatform();
  const temp = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  const fixturePath = platform.path.join("tests", "fixtures", "mcp-server.ts");

  const { StdioTransport } = await import(
    "../../../src/hlvm/agent/mcp/transport.ts"
  );
  const server = { name: "comp", command: ["deno", "run", fixturePath] };
  const transport = new StdioTransport(server);
  const client = new McpClient(server, transport);

  await client.start();
  const values = await client.complete(
    { type: "ref/prompt", name: "greeting" },
    { name: "name", value: "test" },
  );

  assertEquals(values.length, 2);
  assertEquals(values[0], "testcompletion1");
  assertEquals(values[1], "testcompletion2");

  await client.close();
  await platform.fs.remove(temp, { recursive: true });
});

Deno.test("Integration: ping round-trip", async () => {
  const fixturePath = getPlatform().path.join(
    "tests",
    "fixtures",
    "mcp-server.ts",
  );

  const { StdioTransport } = await import(
    "../../../src/hlvm/agent/mcp/transport.ts"
  );
  const server = { name: "pingtest", command: ["deno", "run", fixturePath] };
  const transport = new StdioTransport(server);
  const client = new McpClient(server, transport);

  await client.start();
  // Ping should resolve without error (server returns {})
  await client.ping();

  await client.close();
});

Deno.test("Integration: logging setLevel + notification", async () => {
  const fixturePath = getPlatform().path.join(
    "tests",
    "fixtures",
    "mcp-server.ts",
  );

  const { StdioTransport } = await import(
    "../../../src/hlvm/agent/mcp/transport.ts"
  );
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
  const transport = new StdioTransport(server);
  const client = new McpClient(server, transport);

  await client.start();

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
});

Deno.test({ name: "Integration: sampling round-trip via setHandlers", sanitizeOps: false, fn: async () => {
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

Deno.test({ name: "Integration: elicitation round-trip via setHandlers", sanitizeOps: false, fn: async () => {
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
  // Poll with retries for robustness under load (up to 5s).
  for (let i = 0; i < 50 && !elicitationCalled; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assertEquals(elicitationCalled, true);
  assertEquals(elicitationMessage, "Please confirm deployment");

  await result.dispose();
  await platform.fs.remove(temp, { recursive: true });
}});

Deno.test("Integration: setSignal cancels pending on abort", async () => {
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
});

Deno.test("Integration: resource subscribe and unsubscribe via fixture", async () => {
  const fixturePath = getPlatform().path.join(
    "tests",
    "fixtures",
    "mcp-server.ts",
  );

  const { StdioTransport } = await import(
    "../../../src/hlvm/agent/mcp/transport.ts"
  );
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
  const transport = new StdioTransport(server);
  const client = new McpClient(server, transport);

  await client.start();

  // Both should resolve without error (server returns {})
  await client.subscribeResource("file:///test/readme.md");
  await client.unsubscribeResource("file:///test/readme.md");

  await client.close();
});

Deno.test("McpClient: roots/list handler responds with workspace URIs", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  // Register roots handler
  const rootUris = ["file:///workspace", "file:///home/user"];
  client.onRequest("roots/list", async () => ({
    roots: rootUris.map((uri) => ({ uri })),
  }));

  // Simulate server asking for roots
  transport.injectMessage({
    jsonrpc: "2.0",
    id: 7777,
    method: "roots/list",
    params: {},
  });

  // Wait for async handler
  await new Promise((r) => setTimeout(r, 50));

  // Client should have sent a response with id 7777
  const response = transport.sent.find(
    (m) => m.id === 7777 && m.result !== undefined,
  );
  assertEquals(response !== undefined, true);
  const result = response!.result as { roots: Array<{ uri: string }> };
  assertEquals(result.roots.length, 2);
  assertEquals(result.roots[0].uri, "file:///workspace");
  assertEquals(result.roots[1].uri, "file:///home/user");

  await client.close();
});

// ============================================================
// Version Negotiation — Spec-Compliant Path
// ============================================================

Deno.test("McpClient: accepts server's lower protocol version in response (spec-compliant negotiation)", async () => {
  // Spec: server MUST respond with its own version if it doesn't support client's
  const transport = new MockTransport();
  transport.onMethod("initialize", (msg) => ({
    jsonrpc: "2.0",
    id: msg.id!,
    result: {
      protocolVersion: "2024-11-05", // server offers older version
      serverInfo: { name: "old-server", version: "0.1" },
      capabilities: { tools: {} },
    },
  }));

  const client = new McpClient(
    { name: "negtest", command: ["mock"] },
    transport,
  );
  await client.start();

  // Client should accept the older version and still work
  assertEquals(client.hasCapability("tools"), true);

  // Should have sent initialized notification
  const initialized = transport.sent.find(
    (m) => m.method === "notifications/initialized",
  );
  assertEquals(initialized !== undefined, true);

  await client.close();
});

// ============================================================
// HTTP Transport Tests — Real HTTP Server
// ============================================================

import { HttpTransport } from "../../../src/hlvm/agent/mcp/transport.ts";

/** Start a minimal HTTP MCP server for testing */
function startHttpMcpServer(): {
  port: number;
  server: Deno.HttpServer;
  receivedRequests: Array<{ method: string; headers: Headers; body: unknown }>;
  sessionId: string;
  deleteReceived: boolean;
} {
  const state = {
    port: 0,
    receivedRequests: [] as Array<{
      method: string;
      headers: Headers;
      body: unknown;
    }>,
    sessionId: "test-session-" + Math.random().toString(36).slice(2),
    deleteReceived: false,
    server: null as unknown as Deno.HttpServer,
  };

  const server = Deno.serve({ port: 0, onListen({ port }) { state.port = port; } }, async (req) => {
    // Track DELETE
    if (req.method === "DELETE") {
      state.deleteReceived = true;
      const sid = req.headers.get("Mcp-Session-Id");
      if (sid === state.sessionId) {
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 404 });
    }

    // Only POST for JSON-RPC
    if (req.method !== "POST") {
      return new Response(null, { status: 405 });
    }

    const body = await req.json();
    state.receivedRequests.push({
      method: req.method,
      headers: req.headers,
      body,
    });

    const msg = body as Record<string, unknown>;
    const method = msg.method as string;

    // initialize → return with session ID header
    if (method === "initialize") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2025-11-25",
            serverInfo: { name: "http-test", version: "0.1" },
            capabilities: { tools: {} },
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Mcp-Session-Id": state.sessionId,
          },
        },
      );
    }

    // notifications (no id) → 202 Accepted, no body
    if (msg.id === undefined) {
      return new Response(null, { status: 202 });
    }

    // ping
    if (method === "ping") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // tools/list
    if (method === "tools/list") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            tools: [{
              name: "http_echo",
              description: "Echo via HTTP",
              inputSchema: { type: "object", properties: {} },
            }],
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // tools/call → respond via SSE stream
    if (method === "tools/call") {
      const args = (msg.params as Record<string, unknown>)?.arguments as
        | Record<string, unknown>
        | undefined;
      const sseBody =
        `data: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: `http:${args?.message ?? ""}` } })}\n\n`;
      return new Response(sseBody, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    // Default: method not found
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: "Method not found" },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  });

  state.server = server;
  return state;
}

Deno.test({ name: "HttpTransport: JSON response — initialize + ping round-trip", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const srv = startHttpMcpServer();
  // Wait for server to start
  await new Promise((r) => setTimeout(r, 100));

  const serverConfig = { name: "httptest", url: `http://localhost:${srv.port}` };
  const transport = new HttpTransport(serverConfig);
  const client = new McpClient(serverConfig, transport);

  await client.start();
  assertEquals(client.hasCapability("tools"), true);

  // Ping
  await client.ping();

  // Verify session ID was sent in subsequent requests
  const pingReq = srv.receivedRequests.find(
    (r) => (r.body as Record<string, unknown>).method === "ping",
  );
  assertEquals(
    pingReq?.headers.get("Mcp-Session-Id"),
    srv.sessionId,
  );

  await client.close();
  // Verify DELETE was sent on close
  assertEquals(srv.deleteReceived, true);
  await srv.server.shutdown();
}});

Deno.test({ name: "HttpTransport: SSE stream response — tools/call parsed correctly", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const srv = startHttpMcpServer();
  await new Promise((r) => setTimeout(r, 100));

  const serverConfig = { name: "ssetest", url: `http://localhost:${srv.port}` };
  const transport = new HttpTransport(serverConfig);
  const client = new McpClient(serverConfig, transport);

  await client.start();

  // tools/call responds with SSE — tests consumeSSEStream()
  const result = await client.callTool("http_echo", { message: "hello" });
  assertEquals(
    (result as Record<string, unknown>).content,
    "http:hello",
  );

  await client.close();
  await srv.server.shutdown();
}});

Deno.test({ name: "HttpTransport: session ID stored from initialize and sent on subsequent requests", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const srv = startHttpMcpServer();
  await new Promise((r) => setTimeout(r, 100));

  const serverConfig = { name: "sidtest", url: `http://localhost:${srv.port}` };
  const transport = new HttpTransport(serverConfig);
  const client = new McpClient(serverConfig, transport);

  await client.start();

  // List tools — should include session ID
  const tools = await client.listTools();
  assertEquals(tools.length, 1);
  assertEquals(tools[0].name, "http_echo");

  // Verify session ID was sent
  const listReq = srv.receivedRequests.find(
    (r) => (r.body as Record<string, unknown>).method === "tools/list",
  );
  assertEquals(
    listReq?.headers.get("Mcp-Session-Id"),
    srv.sessionId,
  );

  await client.close();
  await srv.server.shutdown();
}});

Deno.test({ name: "HttpTransport: Accept header includes both json and event-stream", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const srv = startHttpMcpServer();
  await new Promise((r) => setTimeout(r, 100));

  const serverConfig = { name: "hdrtest", url: `http://localhost:${srv.port}` };
  const transport = new HttpTransport(serverConfig);
  const client = new McpClient(serverConfig, transport);

  await client.start();

  // Check Accept header on any request
  const initReq = srv.receivedRequests[0];
  const accept = initReq?.headers.get("Accept") ?? "";
  assertEquals(accept.includes("application/json"), true);
  assertEquals(accept.includes("text/event-stream"), true);

  await client.close();
  await srv.server.shutdown();
}});

Deno.test({ name: "HttpTransport: DELETE on close sends session ID", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const srv = startHttpMcpServer();
  await new Promise((r) => setTimeout(r, 100));

  const serverConfig = { name: "deltest", url: `http://localhost:${srv.port}` };
  const transport = new HttpTransport(serverConfig);
  const client = new McpClient(serverConfig, transport);

  await client.start();
  assertEquals(srv.deleteReceived, false);

  await client.close();
  // Small delay for DELETE to complete
  await new Promise((r) => setTimeout(r, 50));
  assertEquals(srv.deleteReceived, true);

  await srv.server.shutdown();
}});

Deno.test({ name: "HttpTransport: notification gets 202 with no body (no crash)", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const srv = startHttpMcpServer();
  await new Promise((r) => setTimeout(r, 100));

  const serverConfig = { name: "notiftest", url: `http://localhost:${srv.port}` };
  const transport = new HttpTransport(serverConfig);
  const client = new McpClient(serverConfig, transport);

  await client.start();
  // notifications/initialized was already sent during start() — that's a notification
  // Verify it reached the server and didn't crash
  const initNotif = srv.receivedRequests.find(
    (r) =>
      (r.body as Record<string, unknown>).method ===
        "notifications/initialized",
  );
  assertEquals(initNotif !== undefined, true);

  await client.close();
  await srv.server.shutdown();
}});

// ============================================================
// MCP Queue/Replay — Direct Unit Tests
// ============================================================

Deno.test("McpClient: deferrable request queued when no handler, replayed on onRequest", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  // Simulate server sending sampling/createMessage BEFORE handler registered
  transport.injectMessage({
    jsonrpc: "2.0",
    id: 100,
    method: "sampling/createMessage",
    params: { messages: [{ role: "user", content: { type: "text", text: "test" } }] },
  });

  // No response should have been sent yet (queued, not rejected)
  const errorResponse = transport.sent.find(
    (m) => m.id === 100 && m.error !== undefined,
  );
  assertEquals(errorResponse, undefined);

  // Now register the handler — queued request should replay
  let handlerCalled = false;
  let handlerParams: unknown = null;
  client.onRequest("sampling/createMessage", async (params) => {
    handlerCalled = true;
    handlerParams = params;
    return {
      role: "assistant",
      content: { type: "text", text: "replayed" },
      model: "test",
    };
  });

  // Allow microtask for async replay
  await new Promise((r) => setTimeout(r, 50));

  assertEquals(handlerCalled, true);
  const p = handlerParams as Record<string, unknown>;
  assertEquals(Array.isArray(p.messages), true);

  // Response should have been sent back to server
  const response = transport.sent.find(
    (m) => m.id === 100 && m.result !== undefined,
  );
  assertEquals(response !== undefined, true);

  await client.close();
});

Deno.test("McpClient: multiple queued requests all replayed on handler registration", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  // Simulate 3 queued requests before handler
  for (let i = 0; i < 3; i++) {
    transport.injectMessage({
      jsonrpc: "2.0",
      id: 200 + i,
      method: "sampling/createMessage",
      params: { index: i },
    });
  }

  // Register handler — all 3 should replay
  const receivedParams: unknown[] = [];
  client.onRequest("sampling/createMessage", async (params) => {
    receivedParams.push(params);
    return { role: "assistant", content: { type: "text", text: "ok" }, model: "m" };
  });

  await new Promise((r) => setTimeout(r, 50));

  assertEquals(receivedParams.length, 3);
  for (let i = 0; i < 3; i++) {
    assertEquals((receivedParams[i] as Record<string, number>).index, i);
  }

  // All 3 responses sent back
  for (let i = 0; i < 3; i++) {
    const resp = transport.sent.find((m) => m.id === 200 + i && m.result !== undefined);
    assertEquals(resp !== undefined, true, `response for id=${200 + i} should exist`);
  }

  await client.close();
});

Deno.test("McpClient: non-deferrable unknown method gets immediate -32601", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  // Simulate unknown server request
  transport.injectMessage({
    jsonrpc: "2.0",
    id: 300,
    method: "unknown/bogusMethod",
    params: {},
  });

  // Should get immediate -32601 error, NOT queued
  const errorResponse = transport.sent.find(
    (m) => m.id === 300 && m.error !== undefined,
  );
  assertEquals(errorResponse !== undefined, true);
  assertEquals(errorResponse!.error!.code, -32601);

  await client.close();
});

Deno.test("McpClient: elicitation/create is deferrable (queued, not rejected)", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  transport.injectMessage({
    jsonrpc: "2.0",
    id: 400,
    method: "elicitation/create",
    params: { message: "confirm?" },
  });

  // Should NOT have an error response (queued)
  const errorResponse = transport.sent.find(
    (m) => m.id === 400 && m.error !== undefined,
  );
  assertEquals(errorResponse, undefined);

  // Register handler — should replay
  let called = false;
  client.onRequest("elicitation/create", async (params) => {
    called = true;
    return { action: "accept", content: {} };
  });

  await new Promise((r) => setTimeout(r, 50));
  assertEquals(called, true);

  await client.close();
});

Deno.test("McpClient: roots/list is deferrable (queued, not rejected)", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  transport.injectMessage({
    jsonrpc: "2.0",
    id: 500,
    method: "roots/list",
    params: {},
  });

  // Should NOT get -32601
  const errorResponse = transport.sent.find(
    (m) => m.id === 500 && m.error !== undefined,
  );
  assertEquals(errorResponse, undefined);

  // Register handler
  client.onRequest("roots/list", async () => {
    return { roots: [{ uri: "file:///tmp" }] };
  });

  await new Promise((r) => setTimeout(r, 50));

  const response = transport.sent.find(
    (m) => m.id === 500 && m.result !== undefined,
  );
  assertEquals(response !== undefined, true);

  await client.close();
});
