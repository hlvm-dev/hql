import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { AUTO_MODEL_ID } from "../../../src/common/config/types.ts";
import { getHlvmDir, getMcpConfigPath } from "../../../src/common/paths.ts";
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
import { resolvePersistentToolFilter } from "../../../src/hlvm/agent/tool-profiles.ts";
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
    "agent-runner: non-main-thread discoveries stay turn-local and do NOT ratchet into baseline",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Phase 1 routing turn-local semantics (Phase 3 of migration plan):
    // For non-REPL agent mode, tool_search discoveries are tracked in
    // session.discoveredDeferredTools (for cross-session persistence) but
    // are NOT written into the persistent baseline layer. A subsequent
    // turn starts with the lean starter again, not the expanded surface.
    //
    // Evidence rationale: RAG-MCP (arXiv 2505.03275) + Anthropic's
    // Advanced Tool Use benchmarks — ratcheting discoveries into the
    // baseline reintroduces the "too many tools" cliff the starter was
    // designed to avoid.
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
          // Discovery IS tracked on the session set (for cross-session
          // persistence), so later sessions can re-load it.
          assertEquals(
            firstSession.discoveredDeferredTools.has(
              "mcp_productivity_gmail_create_draft",
            ),
            true,
          );

          // After the turn, the persistent baseline should NOT include
          // the discovered tool — discovery is turn-local.
          const firstBaseline =
            firstSession.toolProfileState?.layers.baseline?.allowlist ?? [];
          assertEquals(
            firstBaseline.includes("mcp_productivity_gmail_create_draft"),
            false,
            "discovery must not ratchet into baseline",
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
          // Second turn also starts with the lean starter — no ratchet.
          const secondBaseline =
            secondSession.toolProfileState?.layers.baseline?.allowlist ?? [];
          assertEquals(
            secondBaseline.includes("mcp_productivity_gmail_create_draft"),
            false,
            "baseline does not grow across turns",
          );
          assertEquals(
            secondBaseline.includes("mcp_productivity_calendar_create_event"),
            false,
          );
          assertEquals(
            secondBaseline.includes("mcp_productivity_reminders_create_item"),
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
    "agent-runner: reusable-session routing traces ignore stale turn-local tool layers",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-routing-trace-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });

    const model = "ollama/test-model";
    const modelInfo: ModelInfo = {
      name: "test-model",
      capabilities: ["chat", "tools", "vision"],
    };
    let calls = 0;
    const engine: AgentEngine = {
      createLLM: () => {
        return async () => {
          calls += 1;
          if (calls === 1) {
            return {
              content: "",
              toolCalls: [{
                toolName: "tool_search",
                args: { query: "web tool", limit: 1 },
              }],
            };
          }
          if (calls === 2) {
            return { content: "first done", toolCalls: [] };
          }
          return { content: "second done", toolCalls: [] };
        };
      },
      createSummarizer: () => () => Promise.resolve(""),
    };

    try {
      await withEngineOverride(engine, async () => {
        const reusableSession = await createReusableSession(workspace, model, {
          modelInfo,
        });

        // deno-lint-ignore no-explicit-any
        const firstResult: any = await runAgentQuery({
          query: "Find the web tool",
          model,
          modelInfo,
          workspace,
          querySource: "repl_main_thread",
          reusableSession,
          skipSessionHistory: true,
          retainSessionForReuse: true,
          callbacks: {},
        });

        const firstSession = firstResult.liveSession;
        assertExists(firstSession);
        assertExists(firstSession.toolProfileState?.layers.discovery);

        const traces: TraceEvent[] = [];
        // deno-lint-ignore no-explicit-any
        const secondResult: any = await runAgentQuery({
          query: "Answer without more discovery",
          model,
          modelInfo,
          workspace,
          querySource: "repl_main_thread",
          reusableSession: firstSession,
          skipSessionHistory: true,
          retainSessionForReuse: true,
          callbacks: {
            onTrace: (event) => traces.push(event),
          },
        });

        const secondSession = secondResult.liveSession;
        assertExists(secondSession);
        const routingDecision = traces.find((
          event,
        ): event is Extract<TraceEvent, { type: "routing_decision" }> =>
          event.type === "routing_decision"
        );
        assertExists(routingDecision);
        assertEquals(
          routingDecision.eagerToolCount,
          resolvePersistentToolFilter(secondSession.toolProfileState!)
            .allowlist?.length ?? 0,
        );
      });
    } finally {
      await platform.fs.remove(workspace, { recursive: true });
    }
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
        // Phase 1 routing: pw_* tools are DEFERRED (discoverable via
        // tool_search), not in the eager starter. The model must call
        // tool_search to reach them.
        assertEquals(allowlist.includes("pw_goto"), false);
        assertEquals(allowlist.includes("tool_search"), true);
        // cu_* stays absent from baseline — only widened via
        // widenBaselineForDomainProfile during browser recovery.
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
            // Use read_file — it IS in the lean agent starter, so the
            // tool call resolves successfully. Phase 1 routing moved
            // todo_write to the deferred set (discoverable via
            // tool_search), so it can't be called directly.
            return {
              content: "",
              toolCalls: [{
                toolName: "read_file",
                args: { path: "/nonexistent/smoke-test-file" },
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
        assertEquals(routingDecision.modelCapability, "agent");
        assertEquals(routingDecision.discovery, "tool_search");
        // deferredToolCount depends on dynamically-registered deferred
        // tools (MCP etc.). In isolated unit tests with no MCP loaded,
        // it may legitimately be 0. The routing contract is the discovery
        // channel (== "tool_search"), not the count.
        assertEquals(typeof routingDecision.deferredToolCount, "number");
        assertEquals("taskDomain" in routingDecision, false);
        assertEquals("needsPlan" in routingDecision, false);

        // read_file will fail (path doesn't exist) but the tool_end
        // event is still emitted — that proves the tool was routed
        // through, not rejected as unavailable.
        const readFile = events.find((
          event,
        ): event is Extract<AgentUIEvent, { type: "tool_end" }> =>
          event.type === "tool_end" && event.name === "read_file"
        );
        assertExists(readFile);
      });
    } finally {
      __setListAllProviderModelsForTesting(null);
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: runAgentQuery falls back to an agent-capable local fallback for chat-class models",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      const platform = getPlatform();
      // Write a qwen3:8b manifest — this model IS on the agent-capable
      // allowlist, so it can satisfy agent mode. The old test used gemma4,
      // but gemma4 is now explicitly NOT agent-capable (see memory:
      // project_agent_system_default_broken.md).
      const manifestPath = platform.path.join(
        getHlvmDir(),
        ".runtime",
        "models",
        "manifests",
        "registry.ollama.ai",
        "library",
        "qwen3",
        "8b",
      );
      await platform.fs.mkdir(platform.path.dirname(manifestPath), {
        recursive: true,
      });
      await platform.fs.writeTextFile(
        manifestPath,
        JSON.stringify({
          layers: [
            {
              mediaType: "application/vnd.ollama.image.model",
              digest:
                "sha256:a3de86cd1c13000000000000000000000000000000000000000000000000",
              size: 5_225_387_677,
            },
          ],
        }),
      );

      let capturedModel: string | undefined;
      const engine: AgentEngine = {
        createLLM: (config) => {
          capturedModel = config.model;
          return () => Promise.resolve({ content: "done", toolCalls: [] });
        },
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
        assertExists(result);
        assertEquals(typeof result.text, "string");
      });

      assertEquals(capturedModel, "ollama/qwen3:8b");
    });
  },
});
