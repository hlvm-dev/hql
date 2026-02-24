import { assertEquals } from "jsr:@std/assert";
import { createAgentSession } from "../../../src/hlvm/agent/session.ts";
import { hasTool } from "../../../src/hlvm/agent/registry.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

Deno.test({
  name: "createAgentSession: lazy MCP loading registers tools only on demand",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = await platform.fs.makeTempDir({
      prefix: "hlvm-session-lazy-mcp-",
    });
    const configDir = platform.path.join(workspace, ".hlvm");
    await platform.fs.mkdir(configDir, { recursive: true });

    const fixturePath = platform.path.join(
      platform.process.cwd(),
      "tests",
      "fixtures",
      "mcp-server.ts",
    );
    const configPath = platform.path.join(configDir, "mcp.json");
    await platform.fs.writeTextFile(
      configPath,
      JSON.stringify({
        version: 1,
        servers: [{ name: "test", command: ["deno", "run", fixturePath] }],
      }),
    );

    let session: Awaited<ReturnType<typeof createAgentSession>> | null = null;
    const toolName = "mcp_test_echo";

    try {
      session = await createAgentSession({
        workspace,
        model: "ollama/llama3.2:3b",
        modelInfo: { name: "llama3.2:3b", parameterSize: "13B" },
      });

      assertEquals(hasTool(toolName, session.toolOwnerId), false);

      await session.ensureMcpLoaded?.();
      assertEquals(hasTool(toolName, session.toolOwnerId), true);
    } finally {
      await session?.dispose();
      if (session) {
        assertEquals(hasTool(toolName, session.toolOwnerId), false);
      }
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name: "createAgentSession: weak tier keeps MCP disabled",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = await platform.fs.makeTempDir({
      prefix: "hlvm-session-weak-mcp-",
    });
    const configDir = platform.path.join(workspace, ".hlvm");
    await platform.fs.mkdir(configDir, { recursive: true });

    const fixturePath = platform.path.join(
      platform.process.cwd(),
      "tests",
      "fixtures",
      "mcp-server.ts",
    );
    const configPath = platform.path.join(configDir, "mcp.json");
    await platform.fs.writeTextFile(
      configPath,
      JSON.stringify({
        version: 1,
        servers: [{ name: "test", command: ["deno", "run", fixturePath] }],
      }),
    );

    const toolName = "mcp_test_echo";
    const session = await createAgentSession({
      workspace,
      model: "ollama/llama3.2:1b",
      modelInfo: { name: "llama3.2:1b", parameterSize: "7B" },
    });

    try {
      await session.ensureMcpLoaded?.();
      assertEquals(hasTool(toolName, session.toolOwnerId), false);
    } finally {
      await session.dispose();
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});
