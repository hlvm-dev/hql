import { assertEquals, assertRejects } from "jsr:@std/assert";
import type { Message as AgentMessage } from "../../../src/hlvm/agent/context.ts";
import {
  createReusableSession,
  disposeAllSessions,
  runAgentQuery,
} from "../../../src/hlvm/agent/agent-runner.ts";
import {
  appendPersistedAgentToolResult,
  completePersistedAgentTurn,
  createPersistedAgentChildSession,
  getPersistedAgentSessionId,
  loadPersistedAgentHistory,
  loadPersistedAgentTodos,
  parsePersistedAgentSessionMetadata,
  persistAgentPlanState,
  persistAgentTodos,
  startPersistedAgentTurn,
} from "../../../src/hlvm/agent/persisted-transcript.ts";
import {
  type AgentEngine,
  type AgentLLMConfig,
  resetAgentEngine,
  setAgentEngine,
} from "../../../src/hlvm/agent/engine.ts";
import { getSession } from "../../../src/hlvm/store/conversation-store.ts";
import { loadAllMessages } from "../../../src/hlvm/store/message-utils.ts";
import { setupStoreTestDb } from "../_shared/store-test-db.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { createTodoStateFromPlan } from "../../../src/hlvm/agent/todo-state.ts";

class PersistenceTestEngine implements AgentEngine {
  createLLM(config: AgentLLMConfig) {
    return async (messages: AgentMessage[]) => {
      const sawPriorAssistant = messages.some((message) =>
        message.role === "assistant" && message.content === "persisted:first"
      );
      const lastUser =
        [...messages].reverse().find((message) => message.role === "user")
          ?.content ?? "";
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

class ThrowingPersistenceEngine implements AgentEngine {
  createLLM(_config: AgentLLMConfig) {
    return async () => {
      throw new Error("boom");
    };
  }

  createSummarizer() {
    return async () => "summary";
  }
}

class ResumePlanEngine implements AgentEngine {
  createLLM(config: AgentLLMConfig) {
    return async () => {
      const content = "Wrapped up.\nSTEP_DONE step-2";
      config.onToken?.(content);
      return {
        content,
        toolCalls: [],
        usage: { inputTokens: 9, outputTokens: 4 },
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

Deno.test("persisted transcript: todo state is stored in session metadata", () => {
  const db = setupStoreTestDb();
  try {
    const sessionId = getPersistedAgentSessionId();
    startPersistedAgentTurn(sessionId, "track work");
    persistAgentTodos(sessionId, [{
      id: "step-1",
      content: "Inspect files",
      status: "in_progress",
    }], "tool");

    assertEquals(loadPersistedAgentTodos(sessionId), [{
      id: "step-1",
      content: "Inspect files",
      status: "in_progress",
    }]);
  } finally {
    db.close();
  }
});

Deno.test("persisted transcript: child sessions link back to parent metadata", () => {
  const db = setupStoreTestDb();
  try {
    const parentSessionId = getPersistedAgentSessionId();
    startPersistedAgentTurn(parentSessionId, "parent task");

    const childTurn = createPersistedAgentChildSession({
      parentSessionId,
      agent: "web",
      task: "Inspect docs",
    });
    completePersistedAgentTurn(childTurn, "test-chat/plain", "done");

    const parent = getSession(parentSessionId);
    const child = getSession(childTurn.sessionId);
    const parentMeta = parsePersistedAgentSessionMetadata(parent?.metadata);
    const childMeta = parsePersistedAgentSessionMetadata(child?.metadata);

    assertEquals(
      parentMeta.childSessionIds?.includes(childTurn.sessionId),
      true,
    );
    assertEquals(childMeta.parentSessionId, parentSessionId);
    assertEquals(childMeta.agent, "web");
    assertEquals(childMeta.task, "Inspect docs");
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
        const reusableSession = await createReusableSession(workspace, model, {
          modelInfo: null,
        });

        const first = await runAgentQuery({
          query: "first",
          model,
          workspace,
          reusableSession,
          callbacks: {},
        });
        const second = await runAgentQuery({
          query: "second",
          model,
          workspace,
          reusableSession,
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

Deno.test({
  name:
    "agent-runner: persisted direct runs record a terminal error on failure",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const db = setupStoreTestDb();
    setAgentEngine(new ThrowingPersistenceEngine());

    try {
      await withWorkspace(async (workspace) => {
        const model = "test-chat/plain";
        const reusableSession = await createReusableSession(workspace, model, {
          modelInfo: null,
        });

        await assertRejects(
          () =>
            runAgentQuery({
              query: "explode",
              model,
              workspace,
              reusableSession,
              callbacks: {},
            }),
          Error,
          "boom",
        );

        const messages = loadAllMessages(getPersistedAgentSessionId());
        assertEquals(
          messages.map((message) => [message.role, message.content]),
          [
            ["user", "explode"],
            ["assistant", "Error: boom"],
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

Deno.test({
  name:
    "agent-runner: skipSessionHistory does not restore persisted todos for the session",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const db = setupStoreTestDb();
    setAgentEngine(new PersistenceTestEngine());

    try {
      await withWorkspace(async (workspace) => {
        const model = "test-chat/plain";
        const sessionId = getPersistedAgentSessionId();
        persistAgentTodos(sessionId, [{
          id: "todo-1",
          content: "Old work",
          status: "in_progress",
        }], "tool");
        const reusableSession = await createReusableSession(workspace, model, {
          modelInfo: null,
        });

        await runAgentQuery({
          query: "fresh turn",
          model,
          workspace,
          sessionId,
          skipSessionHistory: true,
          reusableSession,
          callbacks: {},
        });

        assertEquals(reusableSession.todoState.items, []);
      });
    } finally {
      resetAgentEngine();
      await disposeAllSessions();
      db.close();
    }
  },
});

Deno.test({
  name:
    "agent-runner: skipSessionHistory ignores persisted message history even with a sessionId",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const db = setupStoreTestDb();
    setAgentEngine(new PersistenceTestEngine());

    try {
      await withWorkspace(async (workspace) => {
        const model = "test-chat/plain";
        const sessionId = getPersistedAgentSessionId();
        const turn = startPersistedAgentTurn(sessionId, "previous");
        completePersistedAgentTurn(turn, model, "persisted:previous");
        const reusableSession = await createReusableSession(workspace, model, {
          modelInfo: null,
        });

        const result = await runAgentQuery({
          query: "fresh again",
          model,
          workspace,
          sessionId,
          skipSessionHistory: true,
          reusableSession,
          callbacks: {},
        });

        assertEquals(result.text, "persisted:fresh again");
      });
    } finally {
      resetAgentEngine();
      await disposeAllSessions();
      db.close();
    }
  },
});

Deno.test({
  name:
    "agent-runner: resumed plan-owned todos keep syncing when a restored plan advances",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const db = setupStoreTestDb();
    setAgentEngine(new ResumePlanEngine());

    try {
      await withWorkspace(async (workspace) => {
        const model = "test-chat/plain";
        const sessionId = getPersistedAgentSessionId();
        const plan = {
          goal: "Finish the work",
          steps: [
            { id: "step-1", title: "Inspect files" },
            { id: "step-2", title: "Apply fix" },
          ],
        };
        const bootstrapTurn = startPersistedAgentTurn(sessionId, "start");
        completePersistedAgentTurn(bootstrapTurn, model, "Started.");
        persistAgentPlanState(sessionId, plan, ["step-1"]);
        persistAgentTodos(
          sessionId,
          createTodoStateFromPlan(plan.steps, ["step-1"], 1).items,
          "plan",
        );
        const reusableSession = await createReusableSession(workspace, model, {
          modelInfo: null,
        });
        const seenEvents: string[] = [];

        const result = await runAgentQuery({
          query: "continue",
          model,
          workspace,
          sessionId,
          reusableSession,
          callbacks: {
            onAgentEvent: (event) => {
              seenEvents.push(event.type);
            },
          },
        });

        assertEquals(result.text, "Wrapped up.");
        assertEquals(seenEvents.includes("plan_step"), true);
        assertEquals(seenEvents.includes("todo_updated"), true);
        assertEquals(reusableSession.todoState.items, [
          {
            id: "step-1",
            content: "Inspect files",
            status: "completed",
          },
          {
            id: "step-2",
            content: "Apply fix",
            status: "completed",
          },
        ]);
        assertEquals(loadPersistedAgentTodos(sessionId), reusableSession.todoState.items);
        assertEquals(
          parsePersistedAgentSessionMetadata(getSession(sessionId)?.metadata).todoSource,
          "plan",
        );
      });
    } finally {
      resetAgentEngine();
      await disposeAllSessions();
      db.close();
    }
  },
});
