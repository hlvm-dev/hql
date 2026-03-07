import { assertEquals } from "jsr:@std/assert";
import { createSdkMcpClient } from "../../../src/hlvm/agent/mcp/sdk-client.ts";

const SERVER_COMMAND = ["npx", "-y", "@modelcontextprotocol/server-everything"];

function createConfig() {
  return { name: "everything", command: SERVER_COMMAND };
}

async function withClient<T>(fn: (client: Awaited<ReturnType<typeof createSdkMcpClient>>) => Promise<T>): Promise<T> {
  const client = await createSdkMcpClient(createConfig());
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

Deno.test({
  name: "interop/everything: init handshake exposes tool capability",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withClient(async (client) => {
      assertEquals(client.hasCapability("tools"), true);
    });
  },
});

Deno.test({
  name: "interop/everything: tool listing and calls work against the reference server",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withClient(async (client) => {
      const tools = await client.listTools();
      const toolNames = tools.map((tool) => tool.name);
      assertEquals(tools.length > 0, true);
      assertEquals(toolNames.includes("echo"), true);

      const echo = await client.callTool("echo", { message: "conformance-test" }) as Record<string, unknown>;
      const echoContent = (echo.content as Array<Record<string, unknown>>)[0];
      assertEquals(echoContent.type, "text");
      assertEquals((echoContent.text as string).includes("conformance-test"), true);

      const sum = await client.callTool("get-sum", { a: 3, b: 7 }) as Record<string, unknown>;
      const sumContent = (sum.content as Array<Record<string, unknown>>)[0];
      assertEquals(sumContent.type, "text");
      assertEquals((sumContent.text as string).includes("10"), true);
    });
  },
});

Deno.test({
  name: "interop/everything: resources list and read return well-formed content",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withClient(async (client) => {
      const resources = await client.listResources();
      assertEquals(resources.length > 0, true);
      assertEquals(typeof resources[0].uri, "string");
      assertEquals(typeof resources[0].name, "string");

      const contents = await client.readResource(resources[0].uri);
      assertEquals(contents.length > 0, true);
      assertEquals(typeof contents[0].uri, "string");
      assertEquals(contents[0].text !== undefined || contents[0].blob !== undefined, true);
    });
  },
});

Deno.test({
  name: "interop/everything: prompts list known prompt names and ping succeeds",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withClient(async (client) => {
      const prompts = await client.listPrompts();
      const promptNames = prompts.map((prompt) => prompt.name);
      assertEquals(prompts.length > 0, true);
      assertEquals(promptNames.includes("simple-prompt"), true);
      await client.ping();
    });
  },
});
