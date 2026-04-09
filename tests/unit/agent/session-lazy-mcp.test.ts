import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  getMcpConfigPath,
  getToolResultsSessionDir,
} from "../../../src/common/paths.ts";
import { createAgentSession } from "../../../src/hlvm/agent/session.ts";
import { hasTool } from "../../../src/hlvm/agent/registry.ts";
import {
  _resetToolResultStorageForTests,
  persistToolResultSidecar,
} from "../../../src/hlvm/agent/tool-result-storage.ts";
import {
  _resetBrowserStateForTests,
  _testOnly as playwrightTestOnly,
  isBrowserActive,
} from "../../../src/hlvm/agent/playwright/mod.ts";
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
  name:
    "createAgentSession: dispose clears tool-result sidecars for the session",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      _resetToolResultStorageForTests();
      const platform = getPlatform();
      const workspace = await platform.fs.makeTempDir({
        prefix: "hlvm-session-tool-results-",
      });
      const sessionId = "session-tool-results";
      const session = await createAgentSession({
        workspace,
        sessionId,
        model: "ollama/tinyllama:1b",
        modelInfo: { name: "tinyllama:1b", parameterSize: "1B" },
      });

      try {
        await persistToolResultSidecar({
          sessionId,
          toolCallId: "tool-call-1",
          content: "persisted",
          format: "txt",
        });

        assertEquals(
          await platform.fs.exists(getToolResultsSessionDir(sessionId)),
          true,
        );
      } finally {
        await session.dispose();
        await platform.fs.remove(workspace, { recursive: true });
        _resetToolResultStorageForTests();
      }

      assertEquals(
        await platform.fs.exists(getToolResultsSessionDir(sessionId)),
        false,
      );
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
        model: "ollama/tinyllama:1b",
        modelInfo: { name: "tinyllama:1b", parameterSize: "1B" },
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
  name: "createAgentSession: forwards temperature into llmConfig options",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      const platform = getPlatform();
      const workspace = await platform.fs.makeTempDir({
        prefix: "hlvm-session-temperature-",
      });
      const session = await createAgentSession({
        workspace,
        model: "claude-code/claude-haiku-4-5-20251001",
        modelInfo: { name: "claude-haiku-4-5", provider: "anthropic" },
        temperature: 0,
        maxOutputTokens: 2048,
      });

      try {
        assertEquals(session.llmConfig?.options?.temperature, 0);
        assertEquals(session.llmConfig?.options?.maxTokens, 2048);
      } finally {
        await session.dispose();
        await platform.fs.remove(workspace, { recursive: true });
      }
    });
  },
});

Deno.test({
  name:
    "createAgentSession: dispose closes the session-scoped Playwright browser",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      _resetBrowserStateForTests();
      const platform = getPlatform();
      const workspace = await platform.fs.makeTempDir({
        prefix: "hlvm-session-browser-cleanup-",
      });
      const sessionId = "session-browser-cleanup";
      const session = await createAgentSession({
        workspace,
        sessionId,
        model: "claude-code/claude-haiku-4-5-20251001",
        modelInfo: { name: "claude-haiku-4-5", provider: "anthropic" },
      });

      try {
        playwrightTestOnly.primeBrowserSessionForTests(sessionId);
        assertEquals(isBrowserActive(sessionId), true);
      } finally {
        await session.dispose();
        await platform.fs.remove(workspace, { recursive: true });
        _resetBrowserStateForTests();
      }

      assertEquals(isBrowserActive(sessionId), false);
    });
  },
});

Deno.test({
  name:
    "createAgentSession: aborted lazy MCP bootstrap leaves no registered tools behind",
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
          () =>
            session.ensureMcpLoaded?.(controller.signal) ?? Promise.resolve(),
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
