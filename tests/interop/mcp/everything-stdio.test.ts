/**
 * MCP Interop: Tests against @modelcontextprotocol/server-everything
 *
 * Uses the canonical MCP reference server (stdio transport) to verify
 * real-world interoperability. Requires Node.js for `npx`.
 *
 * The reference server supports: tools, resources, prompts, logging, completions.
 */

import { assertEquals } from "jsr:@std/assert";
import { McpClient } from "../../../src/hlvm/agent/mcp/client.ts";
import { StdioTransport } from "../../../src/hlvm/agent/mcp/transport.ts";

const SERVER_COMMAND = ["npx", "-y", "@modelcontextprotocol/server-everything"];

function createReferenceClient(): { client: McpClient; transport: StdioTransport } {
  const config = { name: "everything", command: SERVER_COMMAND };
  const transport = new StdioTransport(config);
  const client = new McpClient(config, transport);
  return { client, transport };
}

// ============================================================
// Init handshake — real server accepts our initialize + initialized
// ============================================================

Deno.test({
  name: "interop/everything: init-handshake",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { client } = createReferenceClient();

    await client.start();
    assertEquals(client.hasCapability("tools"), true, "server must declare tools capability");

    await client.close();
  },
});

// ============================================================
// tools/list returns known tools (echo, get-sum, etc.)
// ============================================================

Deno.test({
  name: "interop/everything: list-tools",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { client } = createReferenceClient();
    await client.start();

    const tools = await client.listTools();
    assertEquals(tools.length > 0, true, "must return at least one tool");

    const toolNames = tools.map((t) => t.name);
    assertEquals(toolNames.includes("echo"), true, "must include 'echo' tool");

    await client.close();
  },
});

// ============================================================
// tools/call echo → correct response
// ============================================================

Deno.test({
  name: "interop/everything: call-echo",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { client } = createReferenceClient();
    await client.start();

    const result = await client.callTool("echo", { message: "conformance-test" });
    const r = result as Record<string, unknown>;
    // The everything server returns {content: [{type: "text", text: "..."}]}
    assertEquals(Array.isArray(r.content), true, "echo must return content array");
    const content = (r.content as Array<Record<string, unknown>>)[0];
    assertEquals(content.type, "text");
    assertEquals(
      (content.text as string).includes("conformance-test"),
      true,
      "echo must include the sent message",
    );

    await client.close();
  },
});

// ============================================================
// tools/call get-sum → correct numeric result
// ============================================================

Deno.test({
  name: "interop/everything: call-add",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { client } = createReferenceClient();
    await client.start();

    const result = await client.callTool("get-sum", { a: 3, b: 7 });
    const r = result as Record<string, unknown>;
    assertEquals(Array.isArray(r.content), true);
    const content = (r.content as Array<Record<string, unknown>>)[0];
    assertEquals(content.type, "text");
    assertEquals(
      (content.text as string).includes("10"),
      true,
      "get-sum(3,7) must return 10",
    );

    await client.close();
  },
});

// ============================================================
// resources/list returns well-formed data
// ============================================================

Deno.test({
  name: "interop/everything: list-resources",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { client } = createReferenceClient();
    await client.start();

    const resources = await client.listResources();
    assertEquals(resources.length > 0, true, "must return at least one resource");
    assertEquals(typeof resources[0].uri, "string", "resource must have uri");
    assertEquals(typeof resources[0].name, "string", "resource must have name");

    await client.close();
  },
});

// ============================================================
// resources/read returns content
// ============================================================

Deno.test({
  name: "interop/everything: read-resource",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { client } = createReferenceClient();
    await client.start();

    // Read the first available resource
    const resources = await client.listResources();
    assertEquals(resources.length > 0, true);

    const contents = await client.readResource(resources[0].uri);
    assertEquals(contents.length > 0, true, "must return at least one content item");
    assertEquals(typeof contents[0].uri, "string", "content must have uri");
    // Content should have either text or blob
    const hasContent = contents[0].text !== undefined || contents[0].blob !== undefined;
    assertEquals(hasContent, true, "content must have text or blob");

    await client.close();
  },
});

// ============================================================
// prompts/list returns well-formed data
// ============================================================

Deno.test({
  name: "interop/everything: list-prompts",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { client } = createReferenceClient();
    await client.start();

    const prompts = await client.listPrompts();
    assertEquals(prompts.length > 0, true, "must return at least one prompt");
    assertEquals(typeof prompts[0].name, "string", "prompt must have name");

    const promptNames = prompts.map((p) => p.name);
    assertEquals(
      promptNames.includes("simple-prompt"),
      true,
      "must include 'simple-prompt'",
    );

    await client.close();
  },
});

// ============================================================
// ping round-trip succeeds
// ============================================================

Deno.test({
  name: "interop/everything: ping",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { client } = createReferenceClient();
    await client.start();

    // ping should resolve without error
    await client.ping();

    await client.close();
  },
});
