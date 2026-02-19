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
