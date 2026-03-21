import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import {
  createReusableSession,
  disposeAllSessions,
  reuseSession,
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

      assertEquals(
        shouldReuseAgentSession(session, {
          model: "claude-code/claude-opus-4-6",
          toolDenylist: ["complete_task"],
        }),
        true,
      );
      assertEquals(
        shouldReuseAgentSession(session, {
          model: "ollama/llama3.2:3b",
          toolDenylist: ["complete_task"],
        }),
        false,
      );
      assertEquals(
        shouldReuseAgentSession(session, {
          model: "claude-code/claude-opus-4-6",
          toolDenylist: ["ask_user", "complete_task"],
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
    "agent-runner: reusable sessions retain the cached provider execution plan across reuse",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-cache-web-plan-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });

    try {
      const session = await createReusableSession(
        workspace,
        "ollama/llama3.2:3b",
        {
          toolAllowlist: ["web_search", "web_fetch"],
          modelInfo: null,
        },
      );
      const reused = await reuseSession(session);

      assertEquals(!!session.providerExecutionPlan, true);
      assertEquals(!!session.webCapabilityPlan, true);
      assertEquals(
        session.llmConfig?.providerExecutionPlan ===
          session.providerExecutionPlan,
        true,
      );
      assertEquals(
        reused.providerExecutionPlan === session.providerExecutionPlan,
        true,
      );
      assertEquals(
        reused.webCapabilityPlan === session.webCapabilityPlan,
        true,
      );
      assertEquals(
        reused.llmConfig?.providerExecutionPlan ===
          session.providerExecutionPlan,
        true,
      );
      assertEquals(
        reused.providerExecutionPlan?.routingProfile,
        "conservative",
      );
      assertEquals(
        reused.webCapabilityPlan?.capabilities.web_search.implementation,
        "custom",
      );
      assertEquals(
        reused.webCapabilityPlan?.capabilities.web_page_read.implementation,
        "custom",
      );
      assertEquals(
        reused.webCapabilityPlan?.capabilities.raw_url_fetch.implementation,
        "disabled",
      );
    } finally {
      await disposeAllSessions();
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: runAgentQuery rejects weak models before agent execution",
  async fn() {
    await assertRejects(
      () =>
        runAgentQuery({
          query: "search the web for latest release notes",
          model: "ollama/llama3.2:1b",
          modelInfo: { name: "llama3.2:1b", parameterSize: "7B" },
          callbacks: {},
          workspace: getPlatform().process.cwd(),
        }),
      ValidationError,
      "Weak models do not support agent mode",
    );
  },
});
