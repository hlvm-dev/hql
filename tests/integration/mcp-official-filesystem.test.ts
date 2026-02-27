import { assert, assertEquals } from "jsr:@std/assert";
import { getPlatform } from "../../src/platform/platform.ts";
import { SdkMcpClient } from "../../src/hlvm/agent/mcp/sdk-client.ts";

function mcpText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> })
    .content;
  if (!Array.isArray(content) || content.length === 0) return "";
  const first = content[0];
  return typeof first?.text === "string" ? first.text : "";
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

Deno.test({
  name: "Integration: official MCP filesystem server works via SdkMcpClient",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const workspace = getPlatform().process.cwd();

    const client = new SdkMcpClient({
      name: "official-filesystem",
      command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", workspace],
    });

    try {
      await withTimeout(client.start(), 120_000, "MCP client start");

      const tools = await withTimeout(client.listTools(), 20_000, "listTools");
      const toolNames = new Set(tools.map((t) => t.name));
      assertEquals(toolNames.has("list_directory"), true);
      assertEquals(toolNames.has("read_file"), true);

      const listResult = await withTimeout(
        client.callTool("list_directory", { path: workspace }),
        30_000,
        "list_directory",
      );
      const listText = mcpText(listResult);
      assert(listText.length > 0, "list_directory should return text content");
      assert(
        listText.includes("README.md") || listText.includes("README"),
        "list_directory output should include README",
      );

      const readResult = await withTimeout(
        client.callTool("read_file", { path: `${workspace}/README.md` }),
        30_000,
        "read_file",
      );
      const readText = mcpText(readResult);
      assert(readText.includes("# HLVM"), "read_file should return README content");
    } finally {
      await client.close();
    }
  },
});
