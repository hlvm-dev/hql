import { assertEquals } from "jsr:@std/assert";
import type { Message as AgentMessage } from "../../../src/hlvm/agent/context.ts";
import {
  disposeAllSessions,
  getOrCreateCachedSession,
  runAgentQuery,
} from "../../../src/hlvm/agent/agent-runner.ts";
import {
  appendPersistedAgentToolResult,
  completePersistedAgentTurn,
  getPersistedAgentSessionId,
  loadPersistedAgentHistory,
  startPersistedAgentTurn,
} from "../../../src/hlvm/agent/persisted-transcript.ts";
import {
  resetAgentEngine,
  setAgentEngine,
  type AgentEngine,
  type AgentLLMConfig,
} from "../../../src/hlvm/agent/engine.ts";
import { loadAllMessages } from "../../../src/hlvm/store/message-utils.ts";
import { setupStoreTestDb } from "../_shared/store-test-db.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

class PersistenceTestEngine implements AgentEngine {
  createLLM(config: AgentLLMConfig) {
    return async (messages: AgentMessage[]) => {
      const sawPriorAssistant = messages.some((message) =>
        message.role === "assistant" && message.content === "persisted:first"
      );
      const lastUser = [...messages].reverse().find((message) =>
        message.role === "user"
      )?.content ?? "";
      const content = sawPriorAssistant
        ? `saw-history:${lastUser}`
        : `persisted:${lastUser}`;
      config.onToken?.(content);
      return {
        content,
        toolCalls: [],
        usage: { inputTokens: 12, outputTokens: 6 },
      };
    };
  }

  createSummarizer() {
    return async () => "summary";
  }
}

async function withWorkspace(
  fn: (workspace: string) => Promise<void>,
): Promise<void> {
  const platform = getPlatform();
  const workspace = await platform.fs.makeTempDir({
    prefix: "hlvm-persisted-agent-",
  });
  try {
    await fn(workspace);
  } finally {
    await platform.fs.remove(workspace, { recursive: true });
  }
}

Deno.test("persisted transcript: SQLite-backed agent history replays stored tool results", async () => {
  const db = setupStoreTestDb();
  try {
    const workspace = "/tmp/agent-history";
    const model = "test-chat/plain";
    const sessionId = getPersistedAgentSessionId();
    const turn = startPersistedAgentTurn(sessionId, "inspect config");
    appendPersistedAgentToolResult(turn, "read_file", "observed-from-tool");
    completePersistedAgentTurn(turn, model, "done");

    const { history } = await loadPersistedAgentHistory({
      model,
      maxGroups: 8,
    });

    const toolIndex = history.findIndex((message) =>
      message.role === "tool" && message.content === "observed-from-tool"
    );
    const finalAssistantIndex = history.findIndex((message) =>
      message.role === "assistant" && message.content === "done"
    );

    assertEquals(toolIndex >= 0, true);
    assertEquals(finalAssistantIndex > toolIndex, true);
  } finally {
    db.close();
  }
});

Deno.test({
  name: "agent-runner: direct persistence uses conversations.db history",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const db = setupStoreTestDb();
    setAgentEngine(new PersistenceTestEngine());

    try {
      await withWorkspace(async (workspace) => {
        const model = "test-chat/plain";
        const cachedSession = await getOrCreateCachedSession(workspace, model, {
          modelInfo: null,
        });

        const first = await runAgentQuery({
          query: "first",
          model,
          workspace,
          cachedSession,
          callbacks: {},
        });
        const second = await runAgentQuery({
          query: "second",
          model,
          workspace,
          cachedSession,
          callbacks: {},
        });

        assertEquals(first.text, "persisted:first");
        assertEquals(second.text, "saw-history:second");

        const messages = loadAllMessages(getPersistedAgentSessionId());
        assertEquals(
          messages.map((message) => [message.role, message.content]),
          [
            ["user", "first"],
            ["assistant", "persisted:first"],
            ["user", "second"],
            ["assistant", "saw-history:second"],
          ],
        );
      });
    } finally {
      resetAgentEngine();
      await disposeAllSessions();
      db.close();
    }
  },
});
