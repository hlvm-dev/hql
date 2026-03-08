import { assertEquals } from "jsr:@std/assert";
import {
  buildConversationItemsFromSessionMessages,
  buildTranscriptStateFromSession,
} from "../../../src/hlvm/cli/repl-ink/conversation-history.ts";
import { setupStoreTestDb } from "../_shared/store-test-db.ts";
import {
  appendPersistedAgentToolResult,
  completePersistedAgentTurn,
  createPersistedAgentChildSession,
  persistAgentPlanState,
  persistAgentTodos,
  startPersistedAgentTurn,
} from "../../../src/hlvm/agent/persisted-transcript.ts";
import { getPersistedAgentSessionId } from "../../../src/hlvm/agent/persisted-transcript.ts";
import { getSession } from "../../../src/hlvm/store/conversation-store.ts";

Deno.test("buildConversationItemsFromSessionMessages preserves user and assistant transcript content in order", () => {
  const items = buildConversationItemsFromSessionMessages([
    {
      role: "user",
      content: "hello",
      ts: 1,
    },
    {
      role: "assistant",
      content: "hi",
      ts: 2,
    },
  ]);

  assertEquals(items.map((item) => item.type), ["user", "assistant"]);
  assertEquals(items[0]?.type, "user");
  if (items[0]?.type === "user") {
    assertEquals(items[0].text, "hello");
  }
  assertEquals(items[1]?.type, "assistant");
  if (items[1]?.type === "assistant") {
    assertEquals(items[1].text, "hi");
    assertEquals(items[1].isPending, false);
  }
});

Deno.test("buildConversationItemsFromSessionMessages groups resumed tool rows", () => {
  const items = buildConversationItemsFromSessionMessages([
    {
      role: "user",
      content: "inspect",
      ts: 1,
    },
    {
      role: "tool",
      content: "README contents",
      toolName: "read_file",
      toolArgsSummary: "README.md",
      toolSuccess: true,
      ts: 2,
    },
    {
      role: "tool",
      content: "package.json contents",
      toolName: "read_file",
      toolArgsSummary: "package.json",
      toolSuccess: false,
      ts: 3,
    },
    {
      role: "assistant",
      content: "done",
      ts: 4,
    },
  ]);

  assertEquals(items.map((item) => item.type), [
    "user",
    "tool_group",
    "assistant",
  ]);
  assertEquals(items[1]?.type, "tool_group");
  if (items[1]?.type === "tool_group") {
    assertEquals(items[1].tools.length, 2);
    assertEquals(items[1].tools[0]?.name, "read_file");
    assertEquals(items[1].tools[0]?.argsSummary, "README.md");
    assertEquals(items[1].tools[0]?.resultText, "README contents");
    assertEquals(items[1].tools[1]?.status, "error");
  }
});

Deno.test("buildConversationItemsFromSessionMessages keeps resumed tool results free of duplicated tool labels", () => {
  const items = buildConversationItemsFromSessionMessages([
    {
      role: "tool",
      content: "raw file contents",
      toolName: "read_file",
      toolArgsSummary: "README.md",
      toolSuccess: true,
      ts: 1,
    },
  ]);

  assertEquals(items[0]?.type, "tool_group");
  if (items[0]?.type === "tool_group") {
    assertEquals(items[0].tools[0]?.name, "read_file");
    assertEquals(items[0].tools[0]?.resultSummaryText, "raw file contents");
  }
});

Deno.test("buildTranscriptStateFromSession restores plan, progress, and resumable child-session cards", () => {
  const db = setupStoreTestDb();
  try {
    const parentSessionId = getPersistedAgentSessionId();
    startPersistedAgentTurn(parentSessionId, "parent task");
    persistAgentTodos(parentSessionId, [{
      id: "todo-1",
      content: "Inspect docs",
      status: "in_progress",
    }], "tool");
    persistAgentPlanState(parentSessionId, {
      goal: "Inspect docs",
      steps: [{
        id: "step-1",
        title: "Inspect docs",
      }],
    }, []);

    const childTurn = createPersistedAgentChildSession({
      parentSessionId,
      agent: "web",
      task: "Inspect docs",
    });
    completePersistedAgentTurn(childTurn, "test-chat/plain", "Found docs");

    const parent = getSession(parentSessionId);
    const state = buildTranscriptStateFromSession({
      meta: {
        id: parentSessionId,
        title: parent?.title ?? "Parent",
        createdAt: 1,
        updatedAt: 2,
        messageCount: 2,
        metadata: parent?.metadata ?? null,
      },
      messages: [{
        role: "user",
        content: "parent task",
        ts: 1,
      }, {
        role: "assistant",
        content: "done",
        ts: 2,
      }],
    });

    assertEquals(state.todoState?.items, [{
      id: "todo-1",
      content: "Inspect docs",
      status: "in_progress",
    }]);
    assertEquals(state.activePlan?.goal, "Inspect docs");
    assertEquals(state.planTodoState?.items, [{
      id: "step-1",
      content: "Inspect docs",
      status: "in_progress",
    }]);

    const delegate = state.items.find((item) => item.type === "delegate");
    assertEquals(delegate?.type, "delegate");
    if (delegate?.type === "delegate") {
      assertEquals(delegate.agent, "web");
      assertEquals(delegate.task, "Inspect docs");
      assertEquals(delegate.status, "success");
      assertEquals(delegate.summary, "Found docs");
      assertEquals(delegate.childSessionId, childTurn.sessionId);
      assertEquals(delegate.snapshot?.finalResponse, "Found docs");
    }
  } finally {
    db.close();
  }
});

Deno.test("buildTranscriptStateFromSession marks incomplete child sessions as errors", () => {
  const db = setupStoreTestDb();
  try {
    const parentSessionId = getPersistedAgentSessionId();
    startPersistedAgentTurn(parentSessionId, "parent task");

    createPersistedAgentChildSession({
      parentSessionId,
      agent: "web",
      task: "Inspect docs",
    });

    const parent = getSession(parentSessionId);
    const state = buildTranscriptStateFromSession({
      meta: {
        id: parentSessionId,
        title: parent?.title ?? "Parent",
        createdAt: 1,
        updatedAt: 2,
        messageCount: 1,
        metadata: parent?.metadata ?? null,
      },
      messages: [{
        role: "user",
        content: "parent task",
        ts: 1,
      }],
    });

    const delegate = state.items.find((item) => item.type === "delegate");
    assertEquals(delegate?.type, "delegate");
    if (delegate?.type === "delegate") {
      assertEquals(delegate.status, "error");
      assertEquals(delegate.error, "Incomplete child session");
    }
  } finally {
    db.close();
  }
});

Deno.test("buildTranscriptStateFromSession restores child snapshot tool failures for resumed delegate cards", () => {
  const db = setupStoreTestDb();
  try {
    const parentSessionId = getPersistedAgentSessionId();
    startPersistedAgentTurn(parentSessionId, "parent task");

    const childTurn = createPersistedAgentChildSession({
      parentSessionId,
      agent: "web",
      task: "Inspect docs",
    });
    appendPersistedAgentToolResult(
      childTurn,
      "search_web",
      "timeout",
      { argsSummary: "docs", success: false },
    );
    completePersistedAgentTurn(childTurn, "test-chat/plain", "Found docs");

    const parent = getSession(parentSessionId);
    const state = buildTranscriptStateFromSession({
      meta: {
        id: parentSessionId,
        title: parent?.title ?? "Parent",
        createdAt: 1,
        updatedAt: 2,
        messageCount: 1,
        metadata: parent?.metadata ?? null,
      },
      messages: [{
        role: "user",
        content: "parent task",
        ts: 1,
      }],
    });

    const delegate = state.items.find((item) => item.type === "delegate");
    assertEquals(delegate?.type, "delegate");
    if (delegate?.type === "delegate") {
      assertEquals(delegate.status, "success");
      assertEquals(delegate.summary, "Found docs");
      assertEquals(delegate.childSessionId, childTurn.sessionId);
      assertEquals(delegate.snapshot?.toolCount, 1);
      assertEquals(delegate.snapshot?.events[0]?.type, "tool_end");
      if (delegate.snapshot?.events[0]?.type === "tool_end") {
        assertEquals(delegate.snapshot.events[0].success, false);
        assertEquals(delegate.snapshot.events[0].argsSummary, "docs");
      }
    }
  } finally {
    db.close();
  }
});
