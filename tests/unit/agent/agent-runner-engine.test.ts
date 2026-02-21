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
