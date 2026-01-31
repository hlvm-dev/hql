import { assertEquals, assertRejects } from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import { loadMcpConfig, loadMcpTools } from "../../../src/hlvm/agent/mcp.ts";
import { getTool, hasTool } from "../../../src/hlvm/agent/registry.ts";

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

  const toolName = "mcp/test/echo";
  assertEquals(hasTool(toolName), true);
  assertEquals(tools.includes(toolName), true);

  const tool = getTool(toolName);
  const result = await tool.fn({ message: "hello" }, temp);
  assertEquals((result as { content: string }).content, "hello");

  await dispose();
  assertEquals(hasTool(toolName), false);

  await platform.fs.remove(temp, { recursive: true });
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
  const tool = getTool("mcp/test/echo");

  await assertRejects(
    () => tool.fn("bad" as unknown as Record<string, unknown>, temp),
  );

  await dispose();
  await platform.fs.remove(temp, { recursive: true });
});
