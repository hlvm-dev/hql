import { assertEquals, assertRejects } from "jsr:@std/assert";
import type { Message as AgentMessage } from "../../../src/hlvm/agent/context.ts";
import {
  createReusableSession,
  disposeAllSessions,
  runAgentQuery,
} from "../../../src/hlvm/agent/agent-runner.ts";
import {
  appendPersistedAgentToolResult,
  clearPersistedAgentPlanningState,
  completePersistedAgentTurn,
  createPersistedAgentChildSession,
  getPersistedAgentSessionId,
  loadPersistedAgentHistory,
  loadPersistedAgentSessionMetadata,
  loadPersistedAgentTodos,
  parsePersistedAgentSessionMetadata,
  persistAgentPlanState,
  persistPendingPlanReview,
  persistAgentTodos,
  startPersistedAgentTurn,
} from "../../../src/hlvm/agent/persisted-transcript.ts";
import {
  type AgentEngine,
  type AgentLLMConfig,
  resetAgentEngine,
  setAgentEngine,
} from "../../../src/hlvm/agent/engine.ts";
import {
  getSession,
  insertMessage,
} from "../../../src/hlvm/store/conversation-store.ts";
import { loadAllMessages } from "../../../src/hlvm/store/message-utils.ts";
import { setupStoreTestDb } from "../_shared/store-test-db.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { createTodoStateFromPlan } from "../../../src/hlvm/agent/todo-state.ts";
import {
  getMemoryMdPath,
  resetHlvmDirCacheForTests,
  setHlvmDirForTests,
} from "../../../src/common/paths.ts";
import { closeFactDb } from "../../../src/hlvm/memory/mod.ts";
import { withGlobalTestLock } from "../_shared/global-test-lock.ts";

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

class MemoryVisibilityEngine implements AgentEngine {
  createLLM(config: AgentLLMConfig) {
    return async (messages: AgentMessage[]) => {
      const sawMemory = messages.some((message) =>
        message.role === "system" &&
        message.content.includes("# Your Memory") &&
        message.content.includes("Durable preference from MEMORY.md")
      );
      const content = sawMemory ? "saw-memory" : "no-memory";
      config.onToken?.(content);
      return {
        content,
        toolCalls: [],
        usage: { inputTokens: 8, outputTokens: 4 },
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

Deno.test({ name: "persisted transcript: SQLite-backed agent history replays stored tool results", sanitizeOps: false, sanitizeResources: false, async fn() {
  const db = setupStoreTestDb();
  try {
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
} });

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

Deno.test({
  name: "persisted transcript: child sessions link back to parent metadata",
  sanitizeOps: false,
  sanitizeResources: false,
  fn() {
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
  },
});

Deno.test("persisted transcript: pending plan review persists in session metadata", () => {
  const db = setupStoreTestDb();
  try {
    const sessionId = getPersistedAgentSessionId();
    startPersistedAgentTurn(sessionId, "edit config");
    const plan = {
      goal: "Edit config safely",
      steps: [{ id: "step-1", title: "Update config" }],
    };

    persistPendingPlanReview(sessionId, "review-1", plan);

    const metadata = loadPersistedAgentSessionMetadata(sessionId);
    assertEquals(metadata.pendingPlanReview?.requestId, "review-1");
    assertEquals(metadata.pendingPlanReview?.plan.goal, "Edit config safely");
  } finally {
    db.close();
  }
});

Deno.test({
  name: "persisted transcript: clearPersistedAgentPlanningState removes plan-owned planning metadata",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const db = setupStoreTestDb();

    try {
      const sessionId = getPersistedAgentSessionId();
      persistAgentPlanState(sessionId, {
        goal: "Organize Desktop",
        steps: [
          { id: "step-1", title: "Create screenshots directory" },
        ],
      }, ["step-1"]);
      persistPendingPlanReview(sessionId, "request-1", {
        goal: "Organize Desktop",
        steps: [
          { id: "step-1", title: "Create screenshots directory" },
        ],
      });
      persistAgentTodos(sessionId, [{
        id: "step-1",
        content: "Create screenshots directory",
        status: "in_progress",
      }], "plan");

      clearPersistedAgentPlanningState(sessionId);

      const metadata = loadPersistedAgentSessionMetadata(sessionId);
      assertEquals(metadata.plan, undefined);
      assertEquals(metadata.completedPlanStepIds, undefined);
      assertEquals(metadata.pendingPlanReview, undefined);
      assertEquals(metadata.approvedPlanSignature, undefined);
      assertEquals(metadata.todos, undefined);
      assertEquals(metadata.todoSource, undefined);
    } finally {
      db.close();
    }
  },
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
          toolDenylist: ["complete_task"],
          callbacks: {},
        });
        const second = await runAgentQuery({
          query: "second",
          model,
          workspace,
          reusableSession,
          toolDenylist: ["complete_task"],
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
              toolDenylist: ["complete_task"],
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
          toolDenylist: ["complete_task"],
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
    "agent-runner: external message history still persists current turn metadata for the session",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const db = setupStoreTestDb();
    setAgentEngine(new PersistenceTestEngine());

    try {
      await withWorkspace(async (workspace) => {
        const model = "test-chat/plain";
        const sessionId = getPersistedAgentSessionId();

        await runAgentQuery({
          query: "with external history",
          model,
          workspace,
          sessionId,
          messageHistory: [{
            role: "assistant",
            content: "external-history",
          }],
          toolDenylist: ["complete_task"],
          callbacks: {},
        });

        const messages = loadAllMessages(sessionId);
        assertEquals(messages[0]?.role, "user");
        assertEquals(messages[0]?.content, "with external history");
        assertEquals(messages[1]?.role, "assistant");
        assertEquals(typeof messages[1]?.content, "string");
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
    "agent-runner: caller-owned transcript persistence does not append a duplicate top-level turn",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const db = setupStoreTestDb();
    setAgentEngine(new PersistenceTestEngine());

    try {
      await withWorkspace(async (workspace) => {
        const model = "test-chat/plain";
        const sessionId = getPersistedAgentSessionId();
        const query = "caller-owned turn";

        insertMessage({
          session_id: sessionId,
          role: "user",
          content: query,
          sender_type: "user",
          request_id: "http-user-turn",
        });
        insertMessage({
          session_id: sessionId,
          role: "assistant",
          content: "",
          sender_type: "agent",
          request_id: "http-assistant-placeholder",
        });

        const reusableSession = await createReusableSession(workspace, model, {
          modelInfo: null,
        });
        const result = await runAgentQuery({
          query,
          model,
          workspace,
          sessionId,
          reusableSession,
          transcriptPersistenceMode: "caller",
          toolDenylist: ["complete_task"],
          callbacks: {},
        });

        assertEquals(result.text, "persisted:caller-owned turn");
        assertEquals(
          loadAllMessages(sessionId).map((message) => [
            message.role,
            message.content,
          ]),
          [
            ["user", query],
            ["assistant", ""],
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
          toolDenylist: ["complete_task"],
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
  name: "agent-runner: skipSessionHistory does not disable durable memory",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withGlobalTestLock(async () => {
      const db = setupStoreTestDb();
      setAgentEngine(new MemoryVisibilityEngine());
      const platform = getPlatform();
      const hlvmDir = await platform.fs.makeTempDir({
        prefix: "hlvm-agent-memory-",
      });
      setHlvmDirForTests(hlvmDir);

      try {
        await platform.fs.mkdir(platform.path.dirname(getMemoryMdPath()), {
          recursive: true,
        });
        await platform.fs.writeTextFile(
          getMemoryMdPath(),
          "Durable preference from MEMORY.md",
        );

        await withWorkspace(async (workspace) => {
          const model = "test-chat/plain";
          const reusableSession = await createReusableSession(workspace, model, {
            modelInfo: null,
          });

          const result = await runAgentQuery({
            query: "fresh but keep durable memory",
            model,
            workspace,
            sessionId: "agent-fresh-memory",
            skipSessionHistory: true,
            reusableSession,
            toolDenylist: ["complete_task"],
            callbacks: {},
          });

          assertEquals(result.text, "saw-memory");
        });
      } finally {
        closeFactDb();
        resetHlvmDirCacheForTests();
        resetAgentEngine();
        await disposeAllSessions();
        await platform.fs.remove(hlvmDir, { recursive: true });
        db.close();
      }
    });
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
        // Verify todos were persisted correctly (plan step processing writes to DB).
        // Note: reusableSession.todoState may not reflect changes when session reuse
        // is skipped due to tier-based tool denylist differences (CU tools filtered for
        // non-vision models). Check persisted state directly as the source of truth.
        const persistedTodos = loadPersistedAgentTodos(sessionId);
        assertEquals(persistedTodos, [
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
