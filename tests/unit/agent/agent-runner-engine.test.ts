import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
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
import { ValidationError } from "../../../src/common/error.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { generateUUID } from "../../../src/common/utils.ts";

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
      assertExists(liveSession, "retainSessionForReuse should return liveSession");
      assertEquals(liveSession.discoveredDeferredTools.has("search_web"), true);
      assertEquals(liveSession.llmConfig?.toolAllowlist?.includes("search_web"), true);
    } finally {
      resetAgentEngine();
      await disposeAllSessions();
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: runAgentQuery rejects constrained models before agent execution",
  async fn() {
    await assertRejects(
      () =>
        runAgentQuery({
          query: "search the web for latest release notes",
          model: "ollama/tinyllama:1b",
          modelInfo: { name: "tinyllama:1b", parameterSize: "1B" },
          callbacks: {},
          workspace: getPlatform().process.cwd(),
        }),
      ValidationError,
      "Constrained models do not support agent mode",
    );
  },
});
