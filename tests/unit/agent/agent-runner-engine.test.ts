import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { AUTO_MODEL_ID } from "../../../src/common/config/types.ts";
import { getMcpConfigPath } from "../../../src/common/paths.ts";
import { __setListAllProviderModelsForTesting } from "../../../src/hlvm/agent/auto-select.ts";
import {
  createReusableSession,
  disposeAllSessions,
  runAgentQuery,
  shouldReuseAgentSession,
} from "../../../src/hlvm/agent/agent-runner.ts";
import { SdkAgentEngine } from "../../../src/hlvm/agent/engine-sdk.ts";
import {
  type AgentEngine,
  resetAgentEngine,
  setAgentEngine,
} from "../../../src/hlvm/agent/engine.ts";
import type {
  AgentUIEvent,
  TraceEvent,
} from "../../../src/hlvm/agent/orchestrator.ts";
import { hasTool } from "../../../src/hlvm/agent/registry.ts";
import { ValidationError } from "../../../src/common/error.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { generateUUID } from "../../../src/common/utils.ts";
import type { ModelInfo } from "../../../src/hlvm/providers/types.ts";
import { withTempHlvmDir } from "../helpers.ts";

async function withEngineOverride(
  engine: AgentEngine,
  fn: () => Promise<void>,
): Promise<void> {
  setAgentEngine(engine);
  try {
    await fn();
  } finally {
    resetAgentEngine();
    await disposeAllSessions();
  }
}

Deno.test({
  name: "agent-runner: default engine wires SdkAgentEngine",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    resetAgentEngine();
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-sdk-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });
    try {
      const session = await createReusableSession(
        workspace,
        "ollama/llama3.2:1b",
        // Prevent provider model discovery/network calls in unit test.
        { modelInfo: null },
      );
      assertExists(session.engine);
      assertEquals(session.engine instanceof SdkAgentEngine, true);
    } finally {
      await disposeAllSessions();
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name: "agent-runner: setAgentEngine override is respected",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-legacy-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });
    try {
      const custom: AgentEngine = {
        createLLM: () => () => Promise.resolve({ content: "", toolCalls: [] }),
        createSummarizer: () => () => Promise.resolve(""),
      };
      await withEngineOverride(custom, async () => {
        const session = await createReusableSession(
          workspace,
          "ollama/llama3.2:1b",
          { modelInfo: null },
        );
        assertExists(session.engine);
        assertEquals(session.engine, custom);
      });
    } finally {
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: reusable sessions are fresh even for same workspace and model",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspaceA = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-cache-a-${generateUUID()}`,
    );
    const workspaceB = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-cache-b-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspaceA, { recursive: true });
    await platform.fs.mkdir(workspaceB, { recursive: true });

    try {
      const model = "ollama/llama3.2:1b";
      const sessionA1 = await createReusableSession(workspaceA, model, {
        modelInfo: null,
      });
      const sessionA2 = await createReusableSession(workspaceA, model, {
        modelInfo: null,
      });
      const sessionB = await createReusableSession(workspaceB, model, {
        modelInfo: null,
      });

      assertEquals(sessionA1 === sessionA2, false);
      assertEquals(sessionA1 === sessionB, false);
    } finally {
      await disposeAllSessions();
      await platform.fs.remove(workspaceA, { recursive: true });
      await platform.fs.remove(workspaceB, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: reusable sessions stay distinct across different option sets",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-cache-opts-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });

    try {
      const model = "ollama/llama3.2:1b";
      const base = await createReusableSession(workspace, model, {
        modelInfo: null,
      });
      const withContext = await createReusableSession(workspace, model, {
        contextWindow: 32768,
        modelInfo: null,
      });
      const withAllowlist = await createReusableSession(workspace, model, {
        toolAllowlist: ["search_web", "web_fetch"],
        modelInfo: null,
      });
      const withDenylist = await createReusableSession(workspace, model, {
        toolDenylist: ["read_file", "shell_exec"],
        modelInfo: null,
      });

      assertEquals(base === withContext, false);
      assertEquals(base === withAllowlist, false);
      assertEquals(base === withDenylist, false);
      assertEquals(withContext === withAllowlist, false);
      assertEquals(withContext === withDenylist, false);
      assertEquals(withAllowlist === withDenylist, false);
    } finally {
      await disposeAllSessions();
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: reusable sessions are not reused across model or denylist changes",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-cache-model-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });

    try {
      const session = await createReusableSession(
        workspace,
        "claude-code/claude-opus-4-6",
        {
          toolDenylist: ["complete_task"],
          modelInfo: null,
        },
      );

      // The session's actual denylist may include extra tools (e.g. Playwright
      // tools when Chromium is unavailable). Use the session's own denylist for
      // the "same config" check so the match is deterministic.
      const sessionDenylist = session.llmConfig?.toolDenylist ?? [];

      assertEquals(
        shouldReuseAgentSession(session, {
          model: "claude-code/claude-opus-4-6",
          toolDenylist: sessionDenylist,
        }),
        true,
      );
      assertEquals(
        shouldReuseAgentSession(session, {
          model: "ollama/llama3.2:3b",
          toolDenylist: sessionDenylist,
        }),
        false,
      );
      assertEquals(
        shouldReuseAgentSession(session, {
          model: "claude-code/claude-opus-4-6",
          toolDenylist: [...sessionDenylist, "ask_user"],
        }),
        false,
      );
    } finally {
      await disposeAllSessions();
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: repl main-thread persists deferred tool discovery across reusable turns",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-main-thread-discovery-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });

    let llmFactoryCount = 0;
    const engine: AgentEngine = {
      createLLM: () => {
        llmFactoryCount += 1;
        const factoryIndex = llmFactoryCount;
        let callCount = 0;
        return async () => {
          callCount += 1;
          // Factory #1: createReusableSession (setup)
          // Factory #2: createAgentSession inside runAgentQuery (new session)
          // Factory #3: runAgentQuery re-creates LLM with updated onToken → used in the loop
          if (factoryIndex === 3 && callCount === 1) {
            return {
              content: "",
              toolCalls: [{
                toolName: "tool_search",
                args: { query: "web search", limit: 1 },
              }],
            };
          }
          return { content: "done", toolCalls: [] };
        };
      },
      createSummarizer: () => () => Promise.resolve(""),
    };

    setAgentEngine(engine);
    try {
      // Create a reusable session (used as seed; runAgentQuery may create its own
      // internal session due to denylist differences from environment-specific
      // tool filtering, but retainSessionForReuse returns the live session).
      const reusableSession = await createReusableSession(
        workspace,
        "ollama/test-model",
        {
          modelInfo: {
            name: "test-model",
            capabilities: ["chat", "tools", "vision"],
          },
        },
      );

      // deno-lint-ignore no-explicit-any
      const firstResult: any = await runAgentQuery({
        query: "Find the web tool",
        model: "ollama/test-model",
        modelInfo: {
          name: "test-model",
          capabilities: ["chat", "tools", "vision"],
        },
        workspace,
        querySource: "repl_main_thread",
        reusableSession,
        skipSessionHistory: true,
        retainSessionForReuse: true,
        callbacks: {},
      });

      // tool_search discovered search_web on the active session
      const liveSession = firstResult.liveSession;
      assertExists(
        liveSession,
        "retainSessionForReuse should return liveSession",
      );
      assertEquals(liveSession.discoveredDeferredTools.has("search_web"), true);
      assertEquals(
        liveSession.llmConfig?.toolAllowlist?.includes("search_web"),
        true,
      );
    } finally {
      resetAgentEngine();
      await disposeAllSessions();
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: enhanced non-main-thread persists discovered MCP tools across reusable turns",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      const platform = getPlatform();
      const workspace = platform.path.join(
        platform.process.cwd(),
        ".tmp",
        `hlvm-agent-enhanced-mcp-${generateUUID()}`,
      );
      const fixturePath = platform.path.join(
        platform.process.cwd(),
        "tests",
        "fixtures",
        "mcp-server.ts",
      );
      await platform.fs.mkdir(workspace, { recursive: true });
      await platform.fs.mkdir(platform.path.dirname(getMcpConfigPath()), {
        recursive: true,
      });
      await platform.fs.writeTextFile(
        getMcpConfigPath(),
        JSON.stringify({
          version: 1,
          servers: [{
            name: "productivity",
            command: [
              "deno",
              "run",
              "--allow-env=MCP_TEST_MODE",
              fixturePath,
            ],
            env: { MCP_TEST_MODE: "productivity_tools" },
          }],
        }),
      );

      let issuedToolSearch = false;
      const engine: AgentEngine = {
        createLLM: () => {
          return async () => {
            if (!issuedToolSearch) {
              issuedToolSearch = true;
              return {
                content: "",
                toolCalls: [{
                  toolName: "tool_search",
                  args: { query: "gmail draft", limit: 1 },
                }],
              };
            }
            return { content: "done", toolCalls: [] };
          };
        },
        createSummarizer: () => () => Promise.resolve(""),
      };

      try {
        await withEngineOverride(engine, async () => {
          const reusableSession = await createReusableSession(
            workspace,
            "anthropic/claude-sonnet",
            { modelInfo: null },
          );

          // deno-lint-ignore no-explicit-any
          const firstResult: any = await runAgentQuery({
            query: "Find the draft email tool",
            model: "anthropic/claude-sonnet",
            modelInfo: null,
            workspace,
            reusableSession,
            skipSessionHistory: true,
            retainSessionForReuse: true,
            callbacks: {},
          });

          const firstSession = firstResult.liveSession;
          assertExists(firstSession);
          assertEquals(
            firstSession.discoveredDeferredTools.has(
              "mcp_productivity_gmail_create_draft",
            ),
            true,
          );
          const firstAllowlist = firstSession.llmConfig?.toolAllowlist ?? [];
          assertEquals(
            firstAllowlist.includes("mcp_productivity_gmail_create_draft"),
            true,
          );
          assertEquals(
            firstAllowlist.includes("mcp_productivity_calendar_create_event"),
            false,
          );
          assertEquals(
            firstAllowlist.includes("mcp_productivity_reminders_create_item"),
            false,
          );

          // deno-lint-ignore no-explicit-any
          const secondResult: any = await runAgentQuery({
            query: "Answer without more discovery",
            model: "anthropic/claude-sonnet",
            modelInfo: null,
            workspace,
            reusableSession: firstSession,
            skipSessionHistory: true,
            retainSessionForReuse: true,
            callbacks: {},
          });

          const secondSession = secondResult.liveSession;
          assertExists(secondSession);
          const secondAllowlist = secondSession.llmConfig?.toolAllowlist ?? [];
          assertEquals(
            secondAllowlist.includes("mcp_productivity_gmail_create_draft"),
            true,
          );
          assertEquals(
            secondAllowlist.includes("mcp_productivity_calendar_create_event"),
            false,
          );
          assertEquals(
            secondAllowlist.includes("mcp_productivity_reminders_create_item"),
            false,
          );
        });
      } finally {
        await platform.fs.remove(workspace, { recursive: true });
      }
    });
  },
});

Deno.test({
  name:
    "agent-runner: non-main-thread sessions do not eagerly load MCP without discovery",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      const platform = getPlatform();
      const workspace = platform.path.join(
        platform.process.cwd(),
        ".tmp",
        `hlvm-agent-lazy-non-main-${generateUUID()}`,
      );
      const fixturePath = platform.path.join(
        platform.process.cwd(),
        "tests",
        "fixtures",
        "mcp-server.ts",
      );
      await platform.fs.mkdir(workspace, { recursive: true });
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

      const engine: AgentEngine = {
        createLLM: () => () =>
          Promise.resolve({ content: "done", toolCalls: [] }),
        createSummarizer: () => () => Promise.resolve(""),
      };

      try {
        await withEngineOverride(engine, async () => {
          const reusableSession = await createReusableSession(
            workspace,
            "anthropic/claude-sonnet",
            { modelInfo: null },
          );

          // deno-lint-ignore no-explicit-any
          const result: any = await runAgentQuery({
            query: "No tool discovery needed",
            model: "anthropic/claude-sonnet",
            modelInfo: null,
            workspace,
            reusableSession,
            skipSessionHistory: true,
            retainSessionForReuse: true,
            callbacks: {},
          });

          const liveSession = result.liveSession;
          assertExists(liveSession);
          assertEquals(
            hasTool("mcp_test_echo", liveSession.toolOwnerId),
            false,
          );
        });
      } finally {
        await platform.fs.remove(workspace, { recursive: true });
      }
    });
  },
});

Deno.test({
  name:
    "agent-runner: browser-shaped requests keep standard eager tools without semantic domain routing",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-browser-domain-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });

    const engine: AgentEngine = {
      createLLM: () => () =>
        Promise.resolve({ content: "done", toolCalls: [] }),
      createSummarizer: () => () => Promise.resolve(""),
    };

    try {
      await withEngineOverride(engine, async () => {
        const reusableSession = await createReusableSession(
          workspace,
          "ollama/test-model",
          {
            modelInfo: {
              name: "test-model",
              capabilities: ["chat", "tools", "vision"],
            },
          },
        );

        // deno-lint-ignore no-explicit-any
        const result: any = await runAgentQuery({
          query: "Open https://example.com with pw_goto and tell me the title",
          model: "ollama/test-model",
          modelInfo: {
            name: "test-model",
            capabilities: ["chat", "tools", "vision"],
          },
          workspace,
          reusableSession,
          skipSessionHistory: true,
          retainSessionForReuse: true,
          callbacks: {},
        });

        const liveSession = result.liveSession;
        assertExists(liveSession);
        assertEquals(liveSession.toolProfileState?.layers.domain, undefined);
        const allowlist = liveSession.llmConfig?.toolAllowlist ?? [];
        assertEquals(allowlist.includes("pw_goto"), true);
        assertEquals(allowlist.includes("pw_promote"), false);
        assertEquals(
          allowlist.some((name: string) => name.startsWith("cu_")),
          false,
        );
      });
    } finally {
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: auto routing selects the model boundary and leaves planning to the agent loop",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-auto-routing-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });

    const traces: TraceEvent[] = [];
    const events: AgentUIEvent[] = [];
    let llmCallCount = 0;
    const engine: AgentEngine = {
      createLLM: () => {
        return async () => {
          llmCallCount += 1;
          if (llmCallCount === 1) {
            return {
              content: "",
              toolCalls: [{
                toolName: "todo_write",
                args: {
                  items: [{
                    id: "step-1",
                    content: "Inspect request",
                    status: "in_progress",
                  }],
                },
              }],
            };
          }
          return {
            content: "Auto routing smoke complete",
            toolCalls: [],
          };
        };
      },
      createSummarizer: () => () => Promise.resolve(""),
    };

    try {
      __setListAllProviderModelsForTesting(() =>
        Promise.resolve<ModelInfo[]>([{
          name: "claude-sonnet-4",
          capabilities: ["chat", "tools", "vision"],
          contextWindow: 200_000,
          metadata: {
            provider: "anthropic",
            cloud: true,
            apiKeyConfigured: true,
          },
        }])
      );

      await withEngineOverride(engine, async () => {
        const result = await runAgentQuery({
          query: "routing auto planning smoke",
          model: AUTO_MODEL_ID,
          workspace,
          skipSessionHistory: true,
          callbacks: {
            onAgentEvent: (event) => events.push(event),
            onTrace: (event) => traces.push(event),
          },
        });

        assertEquals(result.text, "Auto routing smoke complete");
        const routingDecision = traces.find((
          event,
        ): event is Extract<TraceEvent, { type: "routing_decision" }> =>
          event.type === "routing_decision"
        );
        assertExists(routingDecision);
        assertEquals(
          routingDecision.selectedModel,
          "anthropic/claude-sonnet-4",
        );
        assertEquals(routingDecision.modelSource, "auto");
        assertEquals(routingDecision.modelTier, "enhanced");
        assertEquals(routingDecision.discovery, "tool_search");
        assertEquals(routingDecision.deferredToolCount > 0, true);
        assertEquals("taskDomain" in routingDecision, false);
        assertEquals("needsPlan" in routingDecision, false);

        const todoWrite = events.find((
          event,
        ): event is Extract<AgentUIEvent, { type: "tool_end" }> =>
          event.type === "tool_end" && event.name === "todo_write"
        );
        assertExists(todoWrite);
        assertEquals(todoWrite.success, true);
      });
    } finally {
      __setListAllProviderModelsForTesting(null);
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: runAgentQuery falls back to default model for constrained models",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Constrained models (< 3B) can't run agent mode directly.
    // The runner falls back to DEFAULT_MODEL_ID instead of rejecting,
    // so the function completes without throwing a ValidationError.
    const engine: AgentEngine = {
      createLLM: () => () =>
        Promise.resolve({ content: "done", toolCalls: [] }),
      createSummarizer: () => () => Promise.resolve(""),
    };

    await withEngineOverride(engine, async () => {
      // deno-lint-ignore no-explicit-any
      const result: any = await runAgentQuery({
        query: "search the web for latest release notes",
        model: "ollama/tinyllama:1b",
        modelInfo: { name: "tinyllama:1b", parameterSize: "1B" },
        callbacks: {},
        workspace: getPlatform().process.cwd(),
      });
      // Should complete without throwing — model was downgraded to default
      assertExists(result);
      assertEquals(typeof result.text, "string");
    });
  },
});
