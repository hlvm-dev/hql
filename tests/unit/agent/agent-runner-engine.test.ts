import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  disposeAllSessions,
  getOrCreateCachedSession,
} from "../../../src/hlvm/agent/agent-runner.ts";
import { SdkAgentEngine } from "../../../src/hlvm/agent/engine-sdk.ts";
import {
  resetAgentEngine,
  setAgentEngine,
  type AgentEngine,
} from "../../../src/hlvm/agent/engine.ts";
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
      const session = await getOrCreateCachedSession(
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
        const session = await getOrCreateCachedSession(
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
  name: "agent-runner: session cache is workspace-scoped for same model",
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
      const sessionA1 = await getOrCreateCachedSession(workspaceA, model, {
        modelInfo: null,
      });
      const sessionA2 = await getOrCreateCachedSession(workspaceA, model, {
        modelInfo: null,
      });
      const sessionB = await getOrCreateCachedSession(workspaceB, model, {
        modelInfo: null,
      });

      assertEquals(sessionA1, sessionA2);
      assertEquals(sessionA1 === sessionB, false);
    } finally {
      await disposeAllSessions();
      await platform.fs.remove(workspaceA, { recursive: true });
      await platform.fs.remove(workspaceB, { recursive: true });
    }
  },
});

Deno.test({
  name: "agent-runner: session cache key includes context window and denylist",
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
      const base = await getOrCreateCachedSession(workspace, model, {
        modelInfo: null,
      });
      const withContext = await getOrCreateCachedSession(workspace, model, {
        contextWindow: 32768,
        modelInfo: null,
      });
      const withDenylist = await getOrCreateCachedSession(workspace, model, {
        toolDenylist: ["read_file", "shell_exec"],
        modelInfo: null,
      });

      assertEquals(base === withContext, false);
      assertEquals(base === withDenylist, false);
      assertEquals(withContext === withDenylist, false);
    } finally {
      await disposeAllSessions();
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});
