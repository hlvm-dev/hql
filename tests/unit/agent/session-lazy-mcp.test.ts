import { assertEquals, assertRejects } from "jsr:@std/assert";
import { getMcpConfigPath } from "../../../src/common/paths.ts";
import { buildExecutionSurface } from "../../../src/hlvm/agent/execution-surface.ts";
import { createAgentSession } from "../../../src/hlvm/agent/session.ts";
import { hasTool } from "../../../src/hlvm/agent/registry.ts";
import { resolveProviderExecutionPlan } from "../../../src/hlvm/agent/tool-capabilities.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempHlvmDir } from "../helpers.ts";

Deno.test({
  name: "createAgentSession: lazy MCP loading registers tools only on demand",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      const platform = getPlatform();
      const workspace = await platform.fs.makeTempDir({
        prefix: "hlvm-session-lazy-mcp-",
      });
      const fixturePath = platform.path.join(
        platform.process.cwd(),
        "tests",
        "fixtures",
        "mcp-server.ts",
      );
      await platform.fs.mkdir(platform.path.dirname(getMcpConfigPath()), {
        recursive: true,
      });
      await platform.fs.writeTextFile(
        getMcpConfigPath(),
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
    });
  },
});

Deno.test({
  name: "createAgentSession: weak tier keeps MCP disabled",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      const platform = getPlatform();
      const workspace = await platform.fs.makeTempDir({
        prefix: "hlvm-session-weak-mcp-",
      });
      const fixturePath = platform.path.join(
        platform.process.cwd(),
        "tests",
        "fixtures",
        "mcp-server.ts",
      );
      await platform.fs.mkdir(platform.path.dirname(getMcpConfigPath()), {
        recursive: true,
      });
      await platform.fs.writeTextFile(
        getMcpConfigPath(),
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
    });
  },
});

Deno.test({
  name: "createAgentSession: aborted lazy MCP bootstrap leaves no registered tools behind",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      const platform = getPlatform();
      const workspace = await platform.fs.makeTempDir({
        prefix: "hlvm-session-abort-mcp-",
      });
      const fixturePath = platform.path.join(
        platform.process.cwd(),
        "tests",
        "fixtures",
        "mcp-server.ts",
      );
      await platform.fs.mkdir(platform.path.dirname(getMcpConfigPath()), {
        recursive: true,
      });
      await platform.fs.writeTextFile(
        getMcpConfigPath(),
        JSON.stringify({
          version: 1,
          servers: [{ name: "test", command: ["deno", "run", fixturePath] }],
        }),
      );

      const session = await createAgentSession({
        workspace,
        model: "ollama/llama3.2:3b",
        modelInfo: { name: "llama3.2:3b", parameterSize: "13B" },
      });
      const toolName = "mcp_test_echo";
      const controller = new AbortController();
      controller.abort("test abort");

      try {
        await assertRejects(
          () => session.ensureMcpLoaded?.(controller.signal) ?? Promise.resolve(),
          Error,
        );
        assertEquals(hasTool(toolName, session.toolOwnerId), false);
      } finally {
        await session.dispose();
        await platform.fs.remove(workspace, { recursive: true });
      }
    });
  },
});

Deno.test({
  name:
    "createAgentSession: repl main thread does not eagerly load MCP even when execution surface selects MCP",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      const platform = getPlatform();
      const workspace = await platform.fs.makeTempDir({
        prefix: "hlvm-session-main-thread-mcp-",
      });
      const fixturePath = platform.path.join(
        platform.process.cwd(),
        "tests",
        "fixtures",
        "mcp-server.ts",
      );
      await platform.fs.mkdir(platform.path.dirname(getMcpConfigPath()), {
        recursive: true,
      });
      await platform.fs.writeTextFile(
        getMcpConfigPath(),
        JSON.stringify({
          version: 1,
          servers: [{ name: "test", command: ["deno", "run", fixturePath] }],
        }),
      );

      const providerExecutionPlan = resolveProviderExecutionPlan({
        providerName: "ollama",
        nativeCapabilities: {},
      });
      const executionSurface = buildExecutionSurface({
        runtimeMode: "auto",
        activeModelId: "ollama/llama3.2:3b",
        pinnedProviderName: "ollama",
        providerExecutionPlan,
        mcpServers: [{
          name: "test",
          scope: "user",
          scopeLabel: "User",
          transport: "stdio",
          target: "deno run mcp-server.ts",
          reachable: true,
          toolCount: 1,
          contributingCapabilities: ["web.search"],
          contributingTools: ["mcp_test_echo"],
        }],
        mcpCandidates: {
          "web.search": [{
            capabilityId: "web.search",
            serverName: "test",
            toolName: "mcp_test_echo",
            label: "test",
          }],
        },
      });

      let session: Awaited<ReturnType<typeof createAgentSession>> | null = null;
      try {
        session = await createAgentSession({
          workspace,
          model: "ollama/llama3.2:3b",
          modelInfo: { name: "llama3.2:3b", parameterSize: "13B" },
          runtimeMode: "auto",
          querySource: "repl_main_thread",
          providerExecutionPlan,
          executionSurface,
        });

        assertEquals(hasTool("mcp_test_echo", session.toolOwnerId), false);
        await session.ensureMcpLoaded?.();
        assertEquals(hasTool("mcp_test_echo", session.toolOwnerId), true);
      } finally {
        await session?.dispose();
        await platform.fs.remove(workspace, { recursive: true });
      }
    });
  },
});
