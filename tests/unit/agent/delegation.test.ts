/**
 * Tests for multi-agent supervision infrastructure:
 * - ConcurrencyLimiter
 * - Nickname allocation
 * - ThreadRegistry
 * - TaskManager DelegateTask CRUD
 * - Transcript reducer delegate status handling
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import {
  allocateNickname,
  ConcurrencyLimiter,
  resetDelegateLimiter,
} from "../../../src/hlvm/agent/concurrency.ts";
import {
  createDelegateInbox,
  formatDelegateInboxUpdateMessage,
} from "../../../src/hlvm/agent/delegate-inbox.ts";
import { getDelegateTranscriptSnapshot } from "../../../src/hlvm/agent/delegate-transcript.ts";
import {
  createFixtureLLM,
  type LlmFixture,
} from "../../../src/hlvm/agent/llm-fixtures.ts";
import {
  cancelAllThreads,
  cancelThread,
  type DelegateThread,
  getAllThreads,
  getThread,
  registerThread,
  removeThread,
  resetThreadRegistry,
  updateThreadStatus,
} from "../../../src/hlvm/agent/delegate-threads.ts";
import {
  CHILD_TOOL_DENYLIST,
  createDelegateHandler,
} from "../../../src/hlvm/agent/delegation.ts";
import {
  addBatchSpawnFailure,
  addBatchThread,
  getBatchSnapshot,
  registerBatch,
  resetBatchRegistry,
} from "../../../src/hlvm/agent/delegate-batches.ts";
import { createDelegateCoordinationBoard } from "../../../src/hlvm/agent/delegate-coordination.ts";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import {
  createTranscriptState,
  reduceTranscriptState,
} from "../../../src/hlvm/cli/agent-transcript-state.ts";

// ============================================================
// ConcurrencyLimiter
// ============================================================

Deno.test("ConcurrencyLimiter: acquire and release within limit", async () => {
  const limiter = new ConcurrencyLimiter(2);
  assertEquals(limiter.getActive(), 0);

  const release1 = await limiter.acquire("t1");
  assertEquals(limiter.getActive(), 1);

  const release2 = await limiter.acquire("t2");
  assertEquals(limiter.getActive(), 2);

  release1();
  assertEquals(limiter.getActive(), 1);

  release2();
  assertEquals(limiter.getActive(), 0);
});

Deno.test("ConcurrencyLimiter: queue when at capacity", async () => {
  const limiter = new ConcurrencyLimiter(1);

  const release1 = await limiter.acquire("t1");
  assertEquals(limiter.getActive(), 1);
  assertEquals(limiter.getQueued(), 0);

  // This should queue
  let t2Resolved = false;
  const p2 = limiter.acquire("t2").then((release) => {
    t2Resolved = true;
    return release;
  });
  // Allow microtask to run
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(limiter.getQueued(), 1);
  assertEquals(t2Resolved, false);

  // Release t1 should dequeue t2 (t2 now occupies the slot)
  release1();
  const release2 = await p2;
  assertEquals(t2Resolved, true);
  assertEquals(limiter.getQueued(), 0);
  assertEquals(limiter.getActive(), 1); // t2 is now active

  release2();
  assertEquals(limiter.getActive(), 0); // properly released
});

Deno.test("ConcurrencyLimiter: queued acquire rejects on abort without consuming a slot", async () => {
  const limiter = new ConcurrencyLimiter(1);

  const release1 = await limiter.acquire("t1");
  const controller = new AbortController();
  const p2 = limiter.acquire("t2", controller.signal);

  assertEquals(limiter.getActive(), 1);
  assertEquals(limiter.getQueued(), 1);

  controller.abort("cancelled before start");
  await assertRejects(
    () => p2,
    Error,
    "cancelled before start",
  );

  assertEquals(limiter.getQueued(), 0);
  release1();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(limiter.getActive(), 0);
});

Deno.test("ConcurrencyLimiter: tryAcquire returns null at capacity", () => {
  const limiter = new ConcurrencyLimiter(1);

  const release1 = limiter.tryAcquire("t1");
  assertExists(release1);
  assertEquals(limiter.getActive(), 1);

  const release2 = limiter.tryAcquire("t2");
  assertEquals(release2, null);

  release1();
  assertEquals(limiter.getActive(), 0);
});

Deno.test("ConcurrencyLimiter: double release is no-op", async () => {
  const limiter = new ConcurrencyLimiter(2);
  const release = await limiter.acquire("t1");
  assertEquals(limiter.getActive(), 1);

  release();
  assertEquals(limiter.getActive(), 0);

  // Second release should be no-op
  release();
  assertEquals(limiter.getActive(), 0);
});

// ============================================================
// Nickname Allocation
// ============================================================

Deno.test("allocateNickname: returns first unused", () => {
  const active = new Set<string>();
  assertEquals(allocateNickname(active), "Alpha");

  active.add("Alpha");
  assertEquals(allocateNickname(active), "Bravo");

  active.add("Bravo");
  assertEquals(allocateNickname(active), "Charlie");
});

Deno.test("allocateNickname: reuse after removal", () => {
  const active = new Set(["Alpha", "Bravo", "Charlie"]);
  assertEquals(allocateNickname(active), "Delta");

  active.delete("Bravo");
  assertEquals(allocateNickname(active), "Bravo");
});

Deno.test("allocateNickname: fallback when pool exhausted", () => {
  const active = new Set([
    "Alpha",
    "Bravo",
    "Charlie",
    "Delta",
    "Echo",
    "Foxtrot",
    "Golf",
    "Hotel",
    "India",
    "Juliet",
    "Kilo",
    "Lima",
    "Mike",
    "November",
    "Oscar",
    "Papa",
    "Quebec",
    "Romeo",
    "Sierra",
    "Tango",
  ]);
  const name = allocateNickname(active);
  assertEquals(name, "Agent-21");
});

// ============================================================
// Thread Registry
// ============================================================

function createMockThread(
  overrides: Partial<DelegateThread> = {},
): DelegateThread {
  const controller = new AbortController();
  return {
    threadId: overrides.threadId ?? crypto.randomUUID(),
    agent: overrides.agent ?? "code",
    nickname: overrides.nickname ?? "Alpha",
    task: overrides.task ?? "test task",
    status: overrides.status ?? "running",
    controller,
    promise: overrides.promise ?? Promise.resolve({ success: true }),
    ...overrides,
  };
}

Deno.test("ThreadRegistry: register and get", () => {
  resetThreadRegistry();
  const thread = createMockThread({ threadId: "t1" });
  registerThread(thread);

  const found = getThread("t1");
  assertExists(found);
  assertEquals(found.threadId, "t1");
  assertEquals(found.agent, "code");
});

Deno.test("ThreadRegistry: getAllThreads", () => {
  resetThreadRegistry();
  registerThread(createMockThread({ threadId: "t1" }));
  registerThread(createMockThread({ threadId: "t2" }));

  const all = getAllThreads();
  assertEquals(all.length, 2);
});

Deno.test("ThreadRegistry: cancelThread", () => {
  resetThreadRegistry();
  const thread = createMockThread({ threadId: "t1", status: "running" });
  registerThread(thread);

  const cancelled = cancelThread("t1");
  assertEquals(cancelled, true);
  assertEquals(getThread("t1")?.status, "cancelled");
  assertEquals(thread.controller.signal.aborted, true);
  assertExists(getThread("t1")?.completedAt);
});

Deno.test("ThreadRegistry: cancelThread returns false for completed", () => {
  resetThreadRegistry();
  registerThread(createMockThread({ threadId: "t1", status: "completed" }));

  const cancelled = cancelThread("t1");
  assertEquals(cancelled, false);
});

Deno.test("ThreadRegistry: cancelAllThreads", () => {
  resetThreadRegistry();
  registerThread(createMockThread({ threadId: "t1", status: "running" }));
  registerThread(createMockThread({ threadId: "t2", status: "running" }));
  registerThread(createMockThread({ threadId: "t3", status: "completed" }));

  cancelAllThreads();

  assertEquals(getThread("t1")?.status, "cancelled");
  assertEquals(getThread("t2")?.status, "cancelled");
  assertEquals(getThread("t3")?.status, "completed"); // Already completed, not changed
  assertExists(getThread("t1")?.completedAt);
  assertExists(getThread("t2")?.completedAt);
});

Deno.test("ThreadRegistry: updateThreadStatus", () => {
  resetThreadRegistry();
  registerThread(createMockThread({ threadId: "t1", status: "running" }));

  updateThreadStatus("t1", "completed");
  assertEquals(getThread("t1")?.status, "completed");
});

Deno.test("ThreadRegistry: removeThread", () => {
  resetThreadRegistry();
  registerThread(createMockThread({ threadId: "t1" }));

  removeThread("t1");
  assertEquals(getThread("t1"), undefined);
  assertEquals(getAllThreads().length, 0);
});

// ============================================================
// Transcript Reducer: Delegate Status
// ============================================================

Deno.test("transcript reducer: delegate_end cancelled status", () => {
  let state = createTranscriptState();
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_start",
      agent: "code",
      task: "analyze code",
      threadId: "t1",
    },
  });
  // End with abort error → cancelled status
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_end",
      agent: "code",
      task: "analyze code",
      success: false,
      error: "Tool execution aborted",
      durationMs: 500,
      threadId: "t1",
    },
  });

  const delegateItem = state.items.find((item) => item.type === "delegate");
  assertExists(delegateItem);
  if (delegateItem.type === "delegate") {
    assertEquals(delegateItem.status, "cancelled");
  }
});

Deno.test("transcript reducer: concurrent delegates distinguished by threadId", () => {
  let state = createTranscriptState();
  // Start two delegates
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_start",
      agent: "code",
      task: "task A",
      threadId: "t1",
      nickname: "Alpha",
    },
  });
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_start",
      agent: "code",
      task: "task B",
      threadId: "t2",
      nickname: "Bravo",
    },
  });

  assertEquals(
    state.items.filter((i) => i.type === "delegate").length,
    2,
  );

  // Complete only thread t1
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "delegate_end",
      agent: "code",
      task: "task A",
      success: true,
      summary: "A done",
      durationMs: 100,
      threadId: "t1",
    },
  });

  const delegates = state.items.filter((i) => i.type === "delegate");
  const d1 = delegates.find((d) =>
    d.type === "delegate" && d.threadId === "t1"
  );
  const d2 = delegates.find((d) =>
    d.type === "delegate" && d.threadId === "t2"
  );

  assertExists(d1);
  assertExists(d2);
  if (d1?.type === "delegate" && d2?.type === "delegate") {
    assertEquals(d1.status, "success");
    assertEquals(d2.status, "running");
  }
});

// ============================================================
// Delegate Tools: E2E-style tests
// ============================================================

import { DELEGATE_TOOLS } from "../../../src/hlvm/agent/tools/delegate-tools.ts";
import {
  enqueueThreadCompletion,
  updateThreadResult,
  updateThreadSnapshot,
} from "../../../src/hlvm/agent/delegate-threads.ts";
import type { DelegateTranscriptSnapshot } from "../../../src/hlvm/agent/delegate-transcript.ts";

// Cast to (args: unknown) => Promise<unknown> for test convenience.
// The ToolFunction type may require a workspace param (WIP from other domain),
// but these tools don't use it — cast keeps tests isolated from that change.
type TestToolFn = (args: unknown, workspace?: string) => Promise<unknown>;
const waitAgentFn = DELEGATE_TOOLS.wait_agent.fn as TestToolFn;
const listAgentsFn = DELEGATE_TOOLS.list_agents.fn as TestToolFn;
const closeAgentFn = DELEGATE_TOOLS.close_agent.fn as TestToolFn;

Deno.test("list_agents: returns empty list when no threads", async () => {
  resetThreadRegistry();
  const result = await listAgentsFn({}) as Record<string, unknown>;
  assertEquals((result.agents as unknown[]).length, 0);
  assertEquals(result.message, "No delegate threads");
});

Deno.test("list_agents: returns all registered threads", async () => {
  resetThreadRegistry();
  registerThread(createMockThread({
    threadId: "t1",
    nickname: "Alpha",
    agent: "code",
    task: "analyze code",
    status: "running",
  }));
  registerThread(createMockThread({
    threadId: "t2",
    nickname: "Bravo",
    agent: "research",
    task: "find docs",
    status: "completed",
  }));

  const result = await listAgentsFn({}) as Record<string, unknown>;
  const agents = result.agents as Record<string, unknown>[];
  assertEquals(agents.length, 2);
  assertEquals(agents[0].threadId, "t1");
  assertEquals(agents[0].nickname, "Alpha");
  assertEquals(agents[0].agent, "code");
  assertEquals(agents[0].task, "analyze code");
  assertEquals(agents[0].status, "running");
  assertEquals(agents[1].threadId, "t2");
  assertEquals(agents[1].status, "completed");
});

Deno.test("close_agent: cancels running thread", async () => {
  resetThreadRegistry();
  const thread = createMockThread({
    threadId: "t1",
    nickname: "Alpha",
    status: "running",
  });
  registerThread(thread);

  const result = await closeAgentFn({ thread_id: "t1" }) as Record<
    string,
    unknown
  >;
  assertEquals(result.success, true);
  assertEquals(thread.controller.signal.aborted, true);
  assertEquals(getThread("t1")?.status, "cancelled");
});

Deno.test("close_agent: fails for completed thread", async () => {
  resetThreadRegistry();
  registerThread(createMockThread({
    threadId: "t1",
    nickname: "Alpha",
    status: "completed",
  }));

  const result = await closeAgentFn({ thread_id: "t1" }) as Record<
    string,
    unknown
  >;
  assertEquals(result.success, false);
  assertExists((result.message as string).includes("already completed"));
});

Deno.test("close_agent: fails for nonexistent thread", async () => {
  resetThreadRegistry();
  const result = await closeAgentFn({ thread_id: "nonexistent" }) as Record<
    string,
    unknown
  >;
  assertEquals(result.success, false);
  assertExists((result.message as string).includes("No thread found"));
});

Deno.test("close_agent: fails when no thread_id provided", async () => {
  resetThreadRegistry();
  const result = await closeAgentFn({}) as Record<string, unknown>;
  assertEquals(result.success, false);
  assertEquals(result.message, "thread_id is required");
});

Deno.test("wait_agent: returns immediately for already-completed thread", async () => {
  resetThreadRegistry();
  const snapshot: DelegateTranscriptSnapshot = {
    agent: "code",
    task: "test",
    success: true,
    durationMs: 100,
    toolCount: 2,
    finalResponse: "Analysis complete",
    events: [],
  };
  registerThread(createMockThread({
    threadId: "t1",
    nickname: "Alpha",
    agent: "code",
    status: "completed",
  }));
  updateThreadSnapshot("t1", snapshot);

  const result = await waitAgentFn({ thread_id: "t1" }) as Record<
    string,
    unknown
  >;
  assertEquals(result.threadId, "t1");
  assertEquals(result.nickname, "Alpha");
  assertEquals(result.agent, "code");
  assertEquals(result.status, "completed");
  assertEquals(result.result, "Analysis complete");
});

Deno.test("wait_agent: returns error for nonexistent thread", async () => {
  resetThreadRegistry();
  const result = await waitAgentFn({ thread_id: "nonexistent" }) as Record<
    string,
    unknown
  >;
  assertExists(result.error);
  assertEquals(typeof result.error, "string");
});

Deno.test("wait_agent: returns completed thread state without blocking on raw promise settlement", async () => {
  resetThreadRegistry();
  const snapshot: DelegateTranscriptSnapshot = {
    agent: "code",
    task: "test",
    success: true,
    durationMs: 50,
    toolCount: 1,
    finalResponse: "Done",
    events: [],
  };
  let resolvePromise: ((value: { success: boolean; result: string }) => void) | undefined;
  const promise = new Promise<{ success: boolean; result: string }>((resolve) => {
    resolvePromise = resolve;
  });
  const thread = createMockThread({
    threadId: "t1",
    nickname: "Alpha",
    agent: "code",
    status: "running",
    promise: promise as Promise<{ success: boolean }>,
  });
  registerThread(thread);
  setTimeout(() => {
    updateThreadSnapshot("t1", snapshot);
    updateThreadResult("t1", { success: true, result: "Done", snapshot });
    updateThreadStatus("t1", "completed");
    enqueueThreadCompletion("t1");
  }, 20);

  const result = await waitAgentFn({ thread_id: "t1" }) as Record<
    string,
    unknown
  >;
  assertEquals(result.threadId, "t1");
  assertEquals(result.status, "completed");
  assertEquals(result.success, true);
  assertEquals(result.result, "Done");
  resolvePromise?.({ success: true, result: "Done" });
});

Deno.test("wait_agent: timeout fires for stuck thread", async () => {
  resetThreadRegistry();
  // Create a thread that never resolves
  const promise = new Promise<never>(() => {});
  registerThread(createMockThread({
    threadId: "t1",
    nickname: "Alpha",
    status: "running",
    promise,
  }));

  const result = await waitAgentFn({
    thread_id: "t1",
    timeout_ms: 50,
  }) as Record<string, unknown>;
  assertEquals(result.error, "Timeout waiting for agent");
});

Deno.test("wait_agent: no threads returns error", async () => {
  resetThreadRegistry();
  const result = await waitAgentFn({}) as Record<string, unknown>;
  assertEquals(result.error, "No active or completed delegate threads");
});

Deno.test({
  name: "wait_agent: races active threads when no thread_id",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    resetThreadRegistry();
    // Thread 1: resolves after 200ms (slower)
    let slowTimer: ReturnType<typeof setTimeout>;
    const p1 = new Promise<{ success: boolean }>((resolve) => {
      slowTimer = setTimeout(() => resolve({ success: true }), 200);
    });
    // Thread 2: becomes terminal after 30ms (faster — should win the race)
    const p2 = new Promise<{ success: boolean }>((resolve) =>
      setTimeout(() => {
        updateThreadSnapshot("fast", snapshot2);
        updateThreadResult("fast", {
          success: true,
          result: "Fast done",
          snapshot: snapshot2,
        });
        updateThreadStatus("fast", "completed");
        enqueueThreadCompletion("fast");
        resolve({ success: true });
      }, 30)
    );
    const snapshot2: DelegateTranscriptSnapshot = {
      agent: "research",
      task: "fast task",
      success: true,
      durationMs: 30,
      toolCount: 0,
      finalResponse: "Fast done",
      events: [],
    };

    registerThread(createMockThread({
      threadId: "slow",
      nickname: "Alpha",
      agent: "code",
      status: "running",
      promise: p1,
    }));
    registerThread(createMockThread({
      threadId: "fast",
      nickname: "Bravo",
      agent: "research",
      status: "running",
      promise: p2,
    }));
    const result = await waitAgentFn({}) as Record<string, unknown>;
    // The faster thread (Bravo) should win
    assertEquals(result.threadId, "fast");
    assertEquals(result.nickname, "Bravo");
    assertEquals(result.result, "Fast done");

    // Cleanup: cancel the slow timer to prevent leaks
    clearTimeout(slowTimer!);
  },
});

Deno.test({
  name:
    "wait_agent: race path auto-applies clean child changes for winning thread",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    resetThreadRegistry();
    const parentDir = await Deno.makeTempDir();
    const childDir = await Deno.makeTempDir();
    let slowTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      await Deno.writeTextFile(`${parentDir}/file.txt`, "original");
      await Deno.writeTextFile(`${childDir}/file.txt`, "child version");

      const snapshot: DelegateTranscriptSnapshot = {
        agent: "code",
        task: "apply child change",
        success: true,
        durationMs: 20,
        toolCount: 0,
        finalResponse: "Applied",
        events: [],
      };

      const slowPromise = new Promise<{ success: boolean }>((resolve) => {
        slowTimer = setTimeout(() => resolve({ success: true }), 200);
      });
      const fastPromise = new Promise<{ success: boolean }>((resolve) =>
        setTimeout(() => {
          updateThreadResult("race-merge-fast", {
            success: true,
            result: "Applied",
            snapshot,
          });
          updateThreadStatus("race-merge-fast", "completed");
          updateThreadSnapshot("race-merge-fast", snapshot);
          enqueueThreadCompletion("race-merge-fast");
          resolve({ success: true });
        }, 20)
      );

      registerThread(createMockThread({
        threadId: "race-merge-slow",
        nickname: "Alpha",
        agent: "research",
        status: "running",
        promise: slowPromise,
      }));
      registerThread(createMockThread({
        threadId: "race-merge-fast",
        nickname: "Bravo",
        agent: "code",
        status: "running",
        promise: fastPromise,
        workspacePath: childDir,
        workspaceCleanup: async () => {
          try {
            await Deno.remove(childDir, { recursive: true });
          } catch {
            // ignore double cleanup
          }
        },
        filesModified: ["file.txt"],
        parentSnapshots: new Map([["file.txt", "original"]]),
      }));

      const result = await waitAgentFn({}, parentDir) as Record<
        string,
        unknown
      >;
      assertEquals(result.threadId, "race-merge-fast");
      assertEquals(result.filesApplied, ["file.txt"]);
      assertEquals(getThread("race-merge-fast")?.mergeState, "applied");
      assertEquals(getThread("race-merge-fast")?.workspacePath, undefined);
      const parentContent = await Deno.readTextFile(`${parentDir}/file.txt`);
      assertEquals(parentContent, "child version");
    } finally {
      if (slowTimer) clearTimeout(slowTimer);
      await Deno.remove(parentDir, { recursive: true }).catch(() => {});
      await Deno.remove(childDir, { recursive: true }).catch(() => {});
    }
  },
});

// ============================================================
// Delegate Inbox (automatic supervisor intake)
// ============================================================

Deno.test("background delegate queues automatic supervisor update", async () => {
  resetThreadRegistry();
  resetDelegateLimiter();
  const inbox = createDelegateInbox();
  const handler = createDelegateHandler(() =>
    Promise.resolve({
      content: "Delegated result",
      toolCalls: [],
    }), {});

  const response = await handler(
    { agent: "code", task: "inspect codebase", background: true },
    {
      workspace: "/tmp/hlvm-test-delegation",
      context: new ContextManager(),
      permissionMode: "yolo",
      delegateInbox: inbox,
    },
  ) as Record<string, unknown>;

  const threadId = response.threadId;
  assertEquals(typeof threadId, "string");
  const waited = await waitAgentFn({ thread_id: threadId }) as Record<
    string,
    unknown
  >;
  assertEquals(waited.status, "completed");

  const updates = inbox.drain();
  assertEquals(updates.length, 1);
  assertEquals(updates[0].threadId, threadId);
  assertEquals(updates[0].success, true);
  assertStringIncludes(
    formatDelegateInboxUpdateMessage(updates[0]),
    "Delegated result",
  );
});

Deno.test({
  name: "background batch delegates emit delegate_start from runtime handler",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    resetThreadRegistry();
    resetDelegateLimiter();
    const events: Array<Record<string, unknown>> = [];
    const workspace = await Deno.makeTempDir();

    try {
      const handler = createDelegateHandler(() =>
        Promise.resolve({
          content: "Batch item processed",
          toolCalls: [],
        }), {});

      const response = await handler(
        {
          agent: "code",
          task: "inspect row",
          background: true,
          _batchId: "batch-1",
        },
        {
          workspace,
          context: new ContextManager(),
          permissionMode: "yolo",
          onAgentEvent: (event) => events.push(event as unknown as Record<string, unknown>),
        },
      ) as Record<string, unknown>;

      const delegateStarts = events.filter((event) =>
        event.type === "delegate_start" && event.threadId === response.threadId
      );
      assertEquals(delegateStarts.length, 1);
      assertEquals(delegateStarts[0]?.nickname, response.nickname);
      assertEquals(delegateStarts[0]?.agent, "code");
      await waitAgentFn({ thread_id: response.threadId }, workspace);
    } finally {
      await Deno.remove(workspace, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "background delegate watchdog cancels overlong worker and releases limiter slot",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    resetThreadRegistry();
    resetDelegateLimiter();
    const workspace = await Deno.makeTempDir();

    try {
      const handler = createDelegateHandler((_messages, signal) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve({
              content: "Too late",
              toolCalls: [],
            });
          }, 1_000);
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              const error = new Error("Tool execution aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        }), { backgroundWatchdogMs: 40 });

      const response = await handler(
        { agent: "code", task: "stall worker", background: true },
        {
          workspace,
          context: new ContextManager(),
          permissionMode: "yolo",
        },
      ) as Record<string, unknown>;

      const waited = await waitAgentFn({
        thread_id: response.threadId,
        timeout_ms: 1_000,
      }, workspace) as Record<string, unknown>;
      await new Promise((resolve) => setTimeout(resolve, 0));

      assertEquals(waited.status, "cancelled");
      assertStringIncludes(
        String(waited.error),
        "Background delegate lifetime exceeded",
      );
      assertEquals(getDelegateLimiter().getActive(), 0);
    } finally {
      await Deno.remove(workspace, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test("background delegate snapshots parent workspace at spawn time", async () => {
  resetThreadRegistry();
  resetDelegateLimiter();
  const parentDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${parentDir}/root.txt`, "baseline");
    const handler = createDelegateHandler(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        content: "Delegated result",
        toolCalls: [],
      };
    }, {});

    const response = await handler(
      { agent: "code", task: "inspect codebase", background: true },
      {
        workspace: parentDir,
        context: new ContextManager(),
        permissionMode: "yolo",
      },
    ) as Record<string, unknown>;

    const threadId = response.threadId as string;
    let thread = getThread(threadId);
    for (let i = 0; i < 20 && !thread?.parentSnapshots; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      thread = getThread(threadId);
    }
    assertExists(thread);
    assertEquals(thread.parentSnapshots?.get("root.txt"), "baseline");
    await waitAgentFn({ thread_id: threadId }, parentDir);
  } finally {
    await Deno.remove(parentDir, { recursive: true });
  }
});

Deno.test("fixture-backed delegates get fresh child fixture state", async () => {
  resetThreadRegistry();
  resetDelegateLimiter();
  const fixture: LlmFixture = {
    version: 1,
    cases: [
      {
        name: "parent",
        match: { contains: ["parent query"] },
        steps: [
          {
            toolCalls: [{
              id: "delegate_1",
              toolName: "delegate_agent",
              args: {
                agent: "code",
                task: "Inspect parser failure modes",
              },
            }],
          },
          { response: "Parent complete" },
        ],
      },
      {
        name: "child",
        match: { contains: ["Inspect parser failure modes"] },
        steps: [{ response: "Child complete" }],
      },
    ],
  };
  const dir = await Deno.makeTempDir();
  const fixturePath = `${dir}/fixture.json`;
  await Deno.writeTextFile(fixturePath, JSON.stringify(fixture));

  try {
    const parentLlm = createFixtureLLM(fixture);
    const first = await parentLlm([{ role: "user", content: "parent query" }]);
    assertEquals(first.toolCalls?.[0]?.toolName, "delegate_agent");

    const handler = createDelegateHandler(parentLlm, { fixturePath });
    const result = await handler(
      { agent: "code", task: "Inspect parser failure modes" },
      {
        workspace: dir,
        context: new ContextManager(),
        permissionMode: "yolo",
      },
    );

    assertEquals(
      getDelegateTranscriptSnapshot(result)?.finalResponse,
      "Child complete",
    );
    const second = await parentLlm([{ role: "user", content: "parent query" }]);
    assertEquals(second.content, "Parent complete");
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test("foreground delegates strip mutating tools in shared workspace", async () => {
  resetThreadRegistry();
  resetDelegateLimiter();
  let systemNote = "";
  const dir = await Deno.makeTempDir();

  try {
    const handler = createDelegateHandler((messages) => {
      systemNote = messages.find((message) =>
        message.role === "system" && message.content.includes("Allowed tools:")
      )?.content ?? "";
      return Promise.resolve({
        content: "Read-only inspection complete",
        toolCalls: [],
      });
    }, {});

    const result = await handler(
      { agent: "file", task: "Inspect the workspace and report" },
      {
        workspace: dir,
        context: new ContextManager(),
        permissionMode: "yolo",
      },
    );

    assertStringIncludes(
      systemNote,
      "Workspace mode: shared parent workspace without isolation. Stay read-only: inspect, analyze, and report only.",
    );
    assertStringIncludes(systemNote, "Allowed tools: read_file, list_files");
    assertEquals(systemNote.includes("write_file"), false);
    assertEquals(systemNote.includes("edit_file"), false);
    assertEquals(
      getDelegateTranscriptSnapshot(result)?.finalResponse,
      "Read-only inspection complete",
    );
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test("background delegates keep mutating tools when running in isolated workspaces", async () => {
  resetThreadRegistry();
  resetDelegateLimiter();
  let systemNote = "";
  const dir = await Deno.makeTempDir();

  try {
    const handler = createDelegateHandler((messages) => {
      systemNote = messages.find((message) =>
        message.role === "system" && message.content.includes("Allowed tools:")
      )?.content ?? "";
      return Promise.resolve({
        content: "Isolated edit complete",
        toolCalls: [],
      });
    }, {});

    const started = await handler(
      { agent: "file", task: "Update files in isolation", background: true },
      {
        workspace: dir,
        context: new ContextManager(),
        permissionMode: "yolo",
      },
    ) as { threadId: string };

    const waited = await waitAgentFn({ thread_id: started.threadId }, dir) as {
      result?: { result?: string };
    };

    assertStringIncludes(
      systemNote,
      "Workspace mode: isolated child workspace. File changes may be merged later by the parent.",
    );
    assertStringIncludes(
      systemNote,
      "Allowed tools: read_file, write_file, edit_file, list_files",
    );
    assertEquals(waited.result?.result, "Isolated edit complete");
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

// ============================================================
// TaskManager DelegateTask CRUD
// ============================================================

import {
  getTaskManager,
  resetTaskManager,
} from "../../../src/hlvm/cli/repl/task-manager/index.ts";

Deno.test({
  name: "TaskManager: createDelegateTask and findDelegateTaskByThreadId",
  sanitizeOps: false,
  sanitizeResources: false,
  fn() {
    resetTaskManager();
    const tm = getTaskManager();
    const taskId = tm.createDelegateTask(
      "thread-1",
      "code",
      "Alpha",
      "analyze code",
    );

    const found = tm.findDelegateTaskByThreadId("thread-1");
    assertExists(found);
    assertEquals(found!.id, taskId);
    assertEquals(found!.agent, "code");
    assertEquals(found!.nickname, "Alpha");
    assertEquals(found!.task, "analyze code");
    assertEquals(found!.threadId, "thread-1");
    assertEquals(found!.status, "pending");
    assertEquals(found!.type, "delegate");
  },
});

Deno.test("TaskManager: completeDelegateTask updates status and summary", () => {
  resetTaskManager();
  const tm = getTaskManager();
  const taskId = tm.createDelegateTask(
    "thread-2",
    "research",
    "Bravo",
    "find docs",
  );

  tm.completeDelegateTask(taskId, "Found 3 docs");
  const task = tm.findDelegateTaskByThreadId("thread-2");
  assertExists(task);
  assertEquals(task!.status, "completed");
  assertEquals(task!.summary, "Found 3 docs");
});

Deno.test("TaskManager: failDelegateTask updates status and error", () => {
  resetTaskManager();
  const tm = getTaskManager();
  const taskId = tm.createDelegateTask(
    "thread-3",
    "code",
    "Charlie",
    "build feature",
  );

  tm.failDelegateTask(taskId, new Error("Network timeout"));
  const task = tm.findDelegateTaskByThreadId("thread-3");
  assertExists(task);
  assertEquals(task!.status, "failed");
  assertEquals(task!.error?.message, "Network timeout");
});

Deno.test("TaskManager: cancel delegate task also cancels thread", () => {
  resetTaskManager();
  resetThreadRegistry();
  const tm = getTaskManager();

  // Register thread in both registries
  const thread = createMockThread({
    threadId: "thread-4",
    nickname: "Delta",
    agent: "code",
    status: "running",
  });
  registerThread(thread);
  const taskId = tm.createDelegateTask("thread-4", "code", "Delta", "task");

  // Cancel via TaskManager (as BackgroundTasksOverlay would)
  const cancelled = tm.cancel(taskId);
  assertEquals(cancelled, true);

  // Verify thread was also aborted
  assertEquals(thread.controller.signal.aborted, true);
  assertEquals(getThread("thread-4")?.status, "cancelled");
});

Deno.test("TaskManager: findDelegateTaskByThreadId returns undefined for unknown", () => {
  resetTaskManager();
  const tm = getTaskManager();
  assertEquals(tm.findDelegateTaskByThreadId("nonexistent"), undefined);
});

Deno.test("TaskManager: markDelegateThreadRunning buffers start before task creation", () => {
  resetTaskManager();
  const tm = getTaskManager();

  tm.markDelegateThreadRunning("thread-buffered-running");
  tm.createDelegateTask(
    "thread-buffered-running",
    "code",
    "Foxtrot",
    "buffered task",
  );

  const task = tm.findDelegateTaskByThreadId("thread-buffered-running");
  assertExists(task);
  assertEquals(task!.status, "running");
});

Deno.test("TaskManager: resolveDelegateThread buffers completion before task creation", () => {
  resetTaskManager();
  const tm = getTaskManager();

  tm.resolveDelegateThread("thread-buffered-complete", {
    success: true,
    summary: "Buffered done",
  });
  tm.createDelegateTask(
    "thread-buffered-complete",
    "research",
    "Golf",
    "buffered completion task",
  );

  const task = tm.findDelegateTaskByThreadId("thread-buffered-complete");
  assertExists(task);
  assertEquals(task!.status, "completed");
  assertEquals(task!.summary, "Buffered done");
});

Deno.test("TaskManager: resolveDelegateThread treats abort errors as cancelled", () => {
  resetTaskManager();
  const tm = getTaskManager();

  tm.resolveDelegateThread("thread-buffered-cancel", {
    success: false,
    error: "Tool execution aborted",
  });
  tm.createDelegateTask(
    "thread-buffered-cancel",
    "code",
    "Hotel",
    "buffered cancel task",
  );

  const task = tm.findDelegateTaskByThreadId("thread-buffered-cancel");
  assertExists(task);
  assertEquals(task!.status, "cancelled");
});

// ============================================================
// Stage 2: Configurable Concurrency
// ============================================================

import {
  getDelegateLimiter,
  setDelegateLimiterMax,
} from "../../../src/hlvm/agent/concurrency.ts";

Deno.test("setDelegateLimiterMax: changes max for new limiter", () => {
  resetDelegateLimiter();
  setDelegateLimiterMax(3);
  const limiter = getDelegateLimiter();
  // Should allow 3 concurrent acquires
  const r1 = limiter.tryAcquire("a");
  const r2 = limiter.tryAcquire("b");
  const r3 = limiter.tryAcquire("c");
  const r4 = limiter.tryAcquire("d");
  assertExists(r1);
  assertExists(r2);
  assertExists(r3);
  assertEquals(r4, null); // 4th should fail
  r1!();
  r2!();
  r3!();
});

Deno.test("setDelegateLimiterMax: no-op when same max", () => {
  resetDelegateLimiter();
  setDelegateLimiterMax(4);
  const limiter1 = getDelegateLimiter();
  setDelegateLimiterMax(4); // same value
  const limiter2 = getDelegateLimiter();
  assertEquals(limiter1, limiter2); // same instance
});

// ============================================================
// Stage 3: Thread GC
// ============================================================

import { cleanupCompletedThreads } from "../../../src/hlvm/agent/delegate-threads.ts";

Deno.test("cleanupCompletedThreads: removes old threads", () => {
  resetThreadRegistry();
  // Register 3 completed threads with old timestamps
  for (let i = 0; i < 3; i++) {
    const thread = createMockThread({
      threadId: `old-${i}`,
      status: "completed",
    });
    registerThread(thread);
    updateThreadStatus(`old-${i}`, "completed");
    // Backdate completedAt to 1 hour ago
    const t = getThread(`old-${i}`)!;
    t.completedAt = Date.now() - 60 * 60_000;
  }
  // Register 1 recent completed thread
  const recent = createMockThread({ threadId: "recent", status: "completed" });
  registerThread(recent);
  updateThreadStatus("recent", "completed");
  // Register 1 active thread (should NOT be cleaned)
  registerThread(createMockThread({ threadId: "active", status: "running" }));

  const removed = cleanupCompletedThreads(30 * 60_000, 20);
  assertEquals(removed, 3); // 3 old ones removed
  assertEquals(getThread("recent")?.threadId, "recent"); // recent kept
  assertEquals(getThread("active")?.threadId, "active"); // active kept
  assertEquals(getAllThreads().length, 2);
});

Deno.test("cleanupCompletedThreads: respects maxRetained", () => {
  resetThreadRegistry();
  // Register 5 recent completed threads
  for (let i = 0; i < 5; i++) {
    const thread = createMockThread({
      threadId: `t-${i}`,
      status: "completed",
    });
    registerThread(thread);
    updateThreadStatus(`t-${i}`, "completed");
    // Stagger completedAt so ordering is deterministic
    const t = getThread(`t-${i}`)!;
    t.completedAt = Date.now() - i * 1000; // t-0 newest, t-4 oldest
  }

  const removed = cleanupCompletedThreads(999_999_999, 2); // keep only 2
  assertEquals(removed, 3); // 5 - 2 = 3 removed
  // Newest 2 (t-0, t-1) kept
  assertExists(getThread("t-0"));
  assertExists(getThread("t-1"));
  assertEquals(getThread("t-2"), undefined);
  assertEquals(getThread("t-3"), undefined);
  assertEquals(getThread("t-4"), undefined);
});

Deno.test("cleanupCompletedThreads: preserves actionable merge threads", () => {
  resetThreadRegistry();

  for (const [threadId, mergeState] of [
    ["merge-pending", "pending"],
    ["merge-conflicted", "conflicted"],
  ] as const) {
    registerThread(createMockThread({
      threadId,
      status: "completed",
      mergeState,
    }));
    updateThreadStatus(threadId, "completed");
    getThread(threadId)!.completedAt = Date.now() - 60 * 60_000;
  }

  for (let i = 0; i < 2; i++) {
    const threadId = `reapable-${i}`;
    registerThread(createMockThread({
      threadId,
      status: "completed",
    }));
    updateThreadStatus(threadId, "completed");
    getThread(threadId)!.completedAt = Date.now() - 60 * 60_000;
  }

  const removed = cleanupCompletedThreads(30 * 60_000, 0);
  assertEquals(removed, 2);
  assertExists(getThread("merge-pending"));
  assertExists(getThread("merge-conflicted"));
  assertEquals(getThread("reapable-0"), undefined);
  assertEquals(getThread("reapable-1"), undefined);
});

Deno.test("updateThreadStatus: sets completedAt for terminal states", () => {
  resetThreadRegistry();
  registerThread(createMockThread({ threadId: "t1", status: "running" }));

  updateThreadStatus("t1", "completed");
  const t = getThread("t1")!;
  assertExists(t.completedAt);
  assertEquals(typeof t.completedAt, "number");
  assertEquals(t.completedAt! > 0, true);
});

Deno.test("updateThreadStatus: does not set completedAt for non-terminal", () => {
  resetThreadRegistry();
  registerThread(createMockThread({ threadId: "t1", status: "queued" }));

  updateThreadStatus("t1", "running");
  assertEquals(getThread("t1")!.completedAt, undefined);
});

// ============================================================
// Stage 5: Configurable Depth (config validation)
// ============================================================

import { parseValue, validateValue } from "../../../src/common/config/types.ts";

Deno.test("config validation: agentMaxThreads", () => {
  assertEquals(validateValue("agentMaxThreads", undefined).valid, true);
  assertEquals(validateValue("agentMaxThreads", 4).valid, true);
  assertEquals(validateValue("agentMaxThreads", 1).valid, true);
  assertEquals(validateValue("agentMaxThreads", 16).valid, true);
  assertEquals(validateValue("agentMaxThreads", 0).valid, false);
  assertEquals(validateValue("agentMaxThreads", 17).valid, false);
  assertEquals(validateValue("agentMaxThreads", "4").valid, false);
  assertEquals(validateValue("agentMaxThreads", 2.5).valid, false);
});

Deno.test("config validation: agentMaxDepth", () => {
  assertEquals(validateValue("agentMaxDepth", undefined).valid, true);
  assertEquals(validateValue("agentMaxDepth", 1).valid, true);
  assertEquals(validateValue("agentMaxDepth", 3).valid, true);
  assertEquals(validateValue("agentMaxDepth", 0).valid, false);
  assertEquals(validateValue("agentMaxDepth", 4).valid, false);
  assertEquals(validateValue("agentMaxDepth", "1").valid, false);
});

Deno.test("config parseValue: agentMaxThreads and agentMaxDepth parse as integers", () => {
  assertEquals(parseValue("agentMaxThreads", "8"), 8);
  assertEquals(parseValue("agentMaxDepth", "2"), 2);
});

// Config selectors
import {
  getAgentMaxDepth,
  getAgentMaxThreads,
} from "../../../src/common/config/selectors.ts";

Deno.test("getAgentMaxThreads: returns config value or default", () => {
  assertEquals(getAgentMaxThreads({ agentMaxThreads: 8 }), 8);
  assertEquals(getAgentMaxThreads({ agentMaxThreads: 1 }), 1);
  assertEquals(getAgentMaxThreads({}), 4); // default
  assertEquals(getAgentMaxThreads(null), 4); // fallback
  assertEquals(getAgentMaxThreads({ agentMaxThreads: 0 }), 4); // out of range → default
  assertEquals(getAgentMaxThreads({ agentMaxThreads: 20 }), 4); // out of range → default
});

Deno.test("getAgentMaxDepth: returns config value or default", () => {
  assertEquals(getAgentMaxDepth({ agentMaxDepth: 2 }), 2);
  assertEquals(getAgentMaxDepth({ agentMaxDepth: 3 }), 3);
  assertEquals(getAgentMaxDepth({}), 1); // default
  assertEquals(getAgentMaxDepth(null), 1); // fallback
  assertEquals(getAgentMaxDepth({ agentMaxDepth: 0 }), 1); // out of range → default
  assertEquals(getAgentMaxDepth({ agentMaxDepth: 4 }), 1); // out of range → default
});

// ============================================================
// TaskManager: pending→running transition (Stage 1 verification)
// ============================================================

Deno.test("TaskManager: createDelegateTask creates as pending, startDelegateTask transitions to running", () => {
  resetTaskManager();
  const tm = getTaskManager();
  const taskId = tm.createDelegateTask("thread-5", "code", "Echo", "task");
  const task = tm.findDelegateTaskByThreadId("thread-5");
  assertExists(task);
  assertEquals(task!.status, "pending");

  tm.startDelegateTask(taskId);
  const updated = tm.findDelegateTaskByThreadId("thread-5");
  assertExists(updated);
  assertEquals(updated!.status, "running");
});

// ============================================================
// Stage 2: Per-Role Config Overlay
// ============================================================

import { getAgentProfile } from "../../../src/hlvm/agent/agent-registry.ts";

Deno.test("AgentProfile: code profile has temperature override", () => {
  const profile = getAgentProfile("code");
  assertExists(profile);
  assertEquals(profile!.temperature, 0.2);
});

Deno.test("AgentProfile: general profile has no temperature override", () => {
  const profile = getAgentProfile("general");
  assertExists(profile);
  assertEquals(profile!.temperature, undefined);
});

Deno.test("AgentProfile: profile supports maxTokens override", () => {
  const profile = getAgentProfile("code");
  assertExists(profile);
  // maxTokens is optional and defaults to undefined
  assertEquals(profile!.maxTokens, undefined);
});

// ============================================================
// Stage 3: Workspace Isolation
// ============================================================

import {
  applyChildChanges,
  generateChildDiff,
  snapshotWorkspaceFiles,
} from "../../../src/hlvm/agent/delegation.ts";
import { createWorkspaceLease } from "../../../src/hlvm/agent/workspace-leases.ts";

Deno.test("createWorkspaceLease: copies the parent snapshot into an isolated child workspace", async () => {
  const parentDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${parentDir}/existing.txt`, "parent version");
    const lease = await createWorkspaceLease(parentDir, "test-thread-id-1234");
    assertExists(lease);
    assertEquals(typeof lease.path, "string");
    assertEquals(
      lease.kind === "temp_dir" || lease.kind === "git_worktree",
      true,
    );
    const stat = await Deno.stat(lease.path);
    assertEquals(stat.isDirectory, true);

    const childContent = await Deno.readTextFile(`${lease.path}/existing.txt`);
    assertEquals(childContent, "parent version");
    await Deno.writeTextFile(`${lease.path}/existing.txt`, "child version");
    const parentContent = await Deno.readTextFile(`${parentDir}/existing.txt`);
    assertEquals(parentContent, "parent version");

    await lease.cleanup();
    try {
      await Deno.stat(lease.path);
      throw new Error("Should have been deleted");
    } catch (e) {
      assertEquals(e instanceof Deno.errors.NotFound, true);
    }
  } finally {
    await Deno.remove(parentDir, { recursive: true });
  }
});

Deno.test("generateChildDiff: detects new file in child workspace", async () => {
  const parentDir = await Deno.makeTempDir();
  const childDir = await Deno.makeTempDir();
  try {
    // Write a file only in child
    await Deno.writeTextFile(`${childDir}/new-file.txt`, "hello world");
    const result = await generateChildDiff(parentDir, childDir);
    assertExists(result);
    assertEquals(result!.filesModified.length, 1);
    assertEquals(result!.filesModified[0], "new-file.txt");
    assertStringIncludes(result!.diff, "+hello world");
    assertStringIncludes(result!.diff, "new file");
  } finally {
    await Deno.remove(parentDir, { recursive: true });
    await Deno.remove(childDir, { recursive: true });
  }
});

Deno.test("generateChildDiff: detects modified file", async () => {
  const parentDir = await Deno.makeTempDir();
  const childDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${parentDir}/file.txt`, "original");
    await Deno.writeTextFile(`${childDir}/file.txt`, "modified");
    const result = await generateChildDiff(parentDir, childDir);
    assertExists(result);
    assertEquals(result!.filesModified.length, 1);
    assertEquals(result!.filesModified[0], "file.txt");
    assertStringIncludes(result!.diff, "-original");
    assertStringIncludes(result!.diff, "+modified");
  } finally {
    await Deno.remove(parentDir, { recursive: true });
    await Deno.remove(childDir, { recursive: true });
  }
});

Deno.test("generateChildDiff: returns null when no changes", async () => {
  const parentDir = await Deno.makeTempDir();
  const childDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${parentDir}/file.txt`, "same");
    await Deno.writeTextFile(`${childDir}/file.txt`, "same");
    const result = await generateChildDiff(parentDir, childDir);
    assertEquals(result, null);
  } finally {
    await Deno.remove(parentDir, { recursive: true });
    await Deno.remove(childDir, { recursive: true });
  }
});

Deno.test("applyChildChanges: copies modified files to parent", async () => {
  const parentDir = await Deno.makeTempDir();
  const childDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${childDir}/new-file.txt`, "child content");
    const result = await applyChildChanges(parentDir, childDir, [
      "new-file.txt",
    ]);
    assertEquals(result.applied, ["new-file.txt"]);
    assertEquals(result.conflicts.length, 0);
    // Verify file exists in parent
    const content = await Deno.readTextFile(`${parentDir}/new-file.txt`);
    assertEquals(content, "child content");
  } finally {
    await Deno.remove(parentDir, { recursive: true });
    await Deno.remove(childDir, { recursive: true });
  }
});

Deno.test("applyChildChanges: detects real conflict when parent changed since spawn", async () => {
  const parentDir = await Deno.makeTempDir();
  const childDir = await Deno.makeTempDir();
  try {
    // Initial state: both have same file
    await Deno.writeTextFile(`${parentDir}/shared.txt`, "original");
    await Deno.writeTextFile(`${childDir}/shared.txt`, "child version");

    // Snapshot parent at "spawn" time
    const snapshots = await snapshotWorkspaceFiles(parentDir);
    assertEquals(snapshots.get("shared.txt"), "original");

    // Simulate parent changing the file AFTER child was spawned
    await Deno.writeTextFile(`${parentDir}/shared.txt`, "parent changed it");

    // Now apply with snapshots — should detect conflict
    const result = await applyChildChanges(
      parentDir,
      childDir,
      ["shared.txt"],
      snapshots,
    );
    assertEquals(result.conflicts, ["shared.txt"]);
    assertEquals(result.applied.length, 0);

    // Verify parent file was NOT overwritten
    const content = await Deno.readTextFile(`${parentDir}/shared.txt`);
    assertEquals(content, "parent changed it");
  } finally {
    await Deno.remove(parentDir, { recursive: true });
    await Deno.remove(childDir, { recursive: true });
  }
});

Deno.test("applyChildChanges: no conflict when parent unchanged since spawn", async () => {
  const parentDir = await Deno.makeTempDir();
  const childDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${parentDir}/file.txt`, "original");
    await Deno.writeTextFile(`${childDir}/file.txt`, "child version");

    // Snapshot parent at spawn time
    const snapshots = await snapshotWorkspaceFiles(parentDir);

    // Parent NOT changed — apply should succeed
    const result = await applyChildChanges(
      parentDir,
      childDir,
      ["file.txt"],
      snapshots,
    );
    assertEquals(result.applied, ["file.txt"]);
    assertEquals(result.conflicts.length, 0);

    // Verify child content was applied
    const content = await Deno.readTextFile(`${parentDir}/file.txt`);
    assertEquals(content, "child version");
  } finally {
    await Deno.remove(parentDir, { recursive: true });
    await Deno.remove(childDir, { recursive: true });
  }
});

Deno.test("applyChildChanges: detects conflict when parent creates file after spawn", async () => {
  const parentDir = await Deno.makeTempDir();
  const childDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${childDir}/new-file.txt`, "child content");
    const snapshots = new Map<string, string>();

    await Deno.writeTextFile(`${parentDir}/new-file.txt`, "parent content");
    const result = await applyChildChanges(
      parentDir,
      childDir,
      ["new-file.txt"],
      snapshots,
    );

    assertEquals(result.applied.length, 0);
    assertEquals(result.conflicts, ["new-file.txt"]);
    const parentContent = await Deno.readTextFile(`${parentDir}/new-file.txt`);
    assertEquals(parentContent, "parent content");
  } finally {
    await Deno.remove(parentDir, { recursive: true });
    await Deno.remove(childDir, { recursive: true });
  }
});

Deno.test("wait_agent auto-applies clean child changes and records merge state", async () => {
  resetThreadRegistry();
  const parentDir = await Deno.makeTempDir();
  const childDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${parentDir}/file.txt`, "original");
    await Deno.writeTextFile(`${childDir}/file.txt`, "child version");

    const thread = createMockThread({
      threadId: "merge-clean",
      status: "completed",
      workspacePath: childDir,
      workspaceCleanup: async () => {
        try {
          await Deno.remove(childDir, { recursive: true });
        } catch {
          // ignore double cleanup
        }
      },
      filesModified: ["file.txt"],
      parentSnapshots: new Map([["file.txt", "original"]]),
    });
    registerThread(thread);

    const result = await waitAgentFn(
      { thread_id: "merge-clean" },
      parentDir,
    ) as Record<string, unknown>;
    assertEquals(result.filesApplied, ["file.txt"]);
    assertEquals(getThread("merge-clean")?.mergeState, "applied");
    assertEquals(getThread("merge-clean")?.workspacePath, undefined);
    const parentContent = await Deno.readTextFile(`${parentDir}/file.txt`);
    assertEquals(parentContent, "child version");
  } finally {
    await Deno.remove(parentDir, { recursive: true }).catch(() => {});
    await Deno.remove(childDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("wait_agent preserves conflicts until discard_agent_changes", async () => {
  resetThreadRegistry();
  const parentDir = await Deno.makeTempDir();
  const childDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${parentDir}/file.txt`, "original");
    await Deno.writeTextFile(`${childDir}/file.txt`, "child version");
    await Deno.writeTextFile(`${parentDir}/file.txt`, "parent changed");

    const thread = createMockThread({
      threadId: "merge-conflict",
      status: "completed",
      workspacePath: childDir,
      workspaceCleanup: async () => {
        try {
          await Deno.remove(childDir, { recursive: true });
        } catch {
          // ignore double cleanup
        }
      },
      filesModified: ["file.txt"],
      parentSnapshots: new Map([["file.txt", "original"]]),
    });
    registerThread(thread);

    const result = await waitAgentFn(
      { thread_id: "merge-conflict" },
      parentDir,
    ) as Record<string, unknown>;
    assertEquals(result.conflicts, ["file.txt"]);
    assertEquals(getThread("merge-conflict")?.mergeState, "conflicted");
    assertEquals(getThread("merge-conflict")?.workspacePath, childDir);

    const discardFn = DELEGATE_TOOLS.discard_agent_changes.fn as TestToolFn;
    const discard = await discardFn({ thread_id: "merge-conflict" }) as Record<
      string,
      unknown
    >;
    assertEquals(discard.success, true);
    assertEquals(getThread("merge-conflict")?.mergeState, "discarded");
    assertEquals(getThread("merge-conflict")?.workspacePath, undefined);
  } finally {
    await Deno.remove(parentDir, { recursive: true }).catch(() => {});
    await Deno.remove(childDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("apply_agent_changes applies a completed child workspace exactly once", async () => {
  resetThreadRegistry();
  const parentDir = await Deno.makeTempDir();
  const childDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${parentDir}/file.txt`, "original");
    await Deno.writeTextFile(`${childDir}/file.txt`, "child version");

    registerThread(createMockThread({
      threadId: "merge-apply",
      status: "completed",
      workspacePath: childDir,
      workspaceCleanup: async () => {
        try {
          await Deno.remove(childDir, { recursive: true });
        } catch {
          // ignore double cleanup
        }
      },
      filesModified: ["file.txt"],
      parentSnapshots: new Map([["file.txt", "original"]]),
    }));

    const applyFn = DELEGATE_TOOLS.apply_agent_changes.fn as TestToolFn;
    const first = await applyFn(
      { thread_id: "merge-apply" },
      parentDir,
    ) as Record<string, unknown>;
    assertEquals(first.success, true);
    assertEquals(first.applied, ["file.txt"]);
    assertEquals(getThread("merge-apply")?.mergeState, "applied");

    const second = await applyFn(
      { thread_id: "merge-apply" },
      parentDir,
    ) as Record<string, unknown>;
    assertEquals(second.success, true);
    assertEquals(second.applied, ["file.txt"]);
    assertEquals(getThread("merge-apply")?.workspacePath, undefined);
  } finally {
    await Deno.remove(parentDir, { recursive: true }).catch(() => {});
    await Deno.remove(childDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("DelegateBatchRegistry: derives counts from thread state and spawn failures", () => {
  resetBatchRegistry();
  resetThreadRegistry();
  registerBatch("batch-1", "code", 4);
  registerThread(
    createMockThread({
      threadId: "b1-t1",
      status: "queued",
      batchId: "batch-1",
    }),
  );
  registerThread(
    createMockThread({
      threadId: "b1-t2",
      status: "running",
      batchId: "batch-1",
    }),
  );
  registerThread(
    createMockThread({
      threadId: "b1-t3",
      status: "completed",
      batchId: "batch-1",
    }),
  );
  addBatchThread("batch-1", "b1-t1");
  addBatchThread("batch-1", "b1-t2");
  addBatchThread("batch-1", "b1-t3");
  addBatchSpawnFailure("batch-1");

  const snapshot = getBatchSnapshot("batch-1");
  assertExists(snapshot);
  assertEquals(snapshot.queued, 1);
  assertEquals(snapshot.running, 1);
  assertEquals(snapshot.completed, 1);
  assertEquals(snapshot.errored, 1);
  assertEquals(snapshot.spawned, 3);
  assertEquals(snapshot.status, "running");
});

Deno.test("DelegateCoordinationBoard: tracks work by ID and thread", () => {
  const board = createDelegateCoordinationBoard();
  board.ensureItem({
    id: "coord-1",
    goal: "inspect code",
    assignedAgent: "code",
    status: "queued",
  });
  board.attachThread("coord-1", "thread-1");
  board.updateItemByThread("thread-1", {
    status: "completed",
    resultSummary: "Found the issue",
    artifacts: { summary: "Found the issue" },
  });

  const item = board.getByThread("thread-1");
  assertExists(item);
  assertEquals(item.status, "completed");
  assertEquals(item.resultSummary, "Found the issue");
});

// ============================================================
// Stage 5: send_input
// ============================================================

import {
  drainThreadInput,
  sendThreadInput,
} from "../../../src/hlvm/agent/delegate-threads.ts";

Deno.test("sendThreadInput: queues message for active thread", () => {
  resetThreadRegistry();
  registerThread(createMockThread({ threadId: "t1", status: "running" }));
  const sent = sendThreadInput("t1", "change approach to X");
  assertEquals(sent, true);
  const messages = drainThreadInput("t1");
  assertEquals(messages.length, 1);
  assertEquals(messages[0], "change approach to X");
  // Second drain should be empty
  assertEquals(drainThreadInput("t1").length, 0);
});

Deno.test("sendThreadInput: fails for completed thread", () => {
  resetThreadRegistry();
  registerThread(createMockThread({ threadId: "t1", status: "completed" }));
  const sent = sendThreadInput("t1", "too late");
  assertEquals(sent, false);
});

Deno.test("sendThreadInput: fails for nonexistent thread", () => {
  resetThreadRegistry();
  const sent = sendThreadInput("nonexistent", "hello");
  assertEquals(sent, false);
});

// ============================================================
// Stage 6: resume_agent
// ============================================================

Deno.test("resume_agent: fails for thread without childSessionId", async () => {
  resetThreadRegistry();
  registerThread(createMockThread({
    threadId: "t1",
    status: "completed",
  }));
  const resumeFn = DELEGATE_TOOLS.resume_agent.fn as TestToolFn;
  const result = await resumeFn({
    thread_id: "t1",
    prompt: "continue",
  }) as Record<string, unknown>;
  assertEquals(result.success, false);
  assertStringIncludes(result.message as string, "no persisted session");
});

Deno.test("resume_agent: fails for active thread", async () => {
  resetThreadRegistry();
  const thread = createMockThread({
    threadId: "t2",
    status: "running",
  });
  thread.childSessionId = "session-123";
  registerThread(thread);
  const resumeFn = DELEGATE_TOOLS.resume_agent.fn as TestToolFn;
  const result = await resumeFn({
    thread_id: "t2",
    prompt: "continue",
  }) as Record<string, unknown>;
  assertEquals(result.success, false);
  assertStringIncludes(result.message as string, "running");
});

// ============================================================
// Stage 8: report_result
// ============================================================

Deno.test("report_result: requires summary", async () => {
  const reportFn = DELEGATE_TOOLS.report_result.fn as TestToolFn;
  const result = await reportFn({}) as Record<string, unknown>;
  assertEquals(result.success, false);
  assertEquals(result.message, "summary is required");
});

// ============================================================
// Stage 1: Enhanced Delegation Prompt
// ============================================================

import { generateSystemPrompt } from "../../../src/hlvm/agent/llm-integration.ts";

Deno.test("renderDelegation: frontier tier generates multi-paragraph prompt", () => {
  // Generate prompt with delegate_agent available (frontier)
  const prompt = generateSystemPrompt({
    modelTier: "frontier",
    toolAllowlist: ["delegate_agent"],
  });
  assertStringIncludes(prompt, "When to Delegate");
  assertStringIncludes(prompt, "When NOT to Delegate");
  assertStringIncludes(prompt, "Coordination Patterns");
  assertStringIncludes(prompt, "Fan-out");
  assertStringIncludes(prompt, "Available Agents");
});

Deno.test("renderDelegation: weak tier generates abbreviated prompt", () => {
  const prompt = generateSystemPrompt({
    modelTier: "weak",
    toolAllowlist: ["delegate_agent"],
  });
  // Should have agent list but NOT the full guidance
  assertStringIncludes(prompt, "Delegation");
  // Weak tier should NOT include the detailed sections
  assertEquals(prompt.includes("When to Delegate"), false);
  assertEquals(prompt.includes("Coordination Patterns"), false);
});

// ============================================================
// Fix 1: Worker member retirement (maxMembers not cumulative)
// ============================================================

import { createTeamRuntime } from "../../../src/hlvm/agent/team-runtime.ts";

Deno.test("completed delegates terminate their team member so maxMembers is not cumulative", async () => {
  resetThreadRegistry();
  resetDelegateLimiter();

  const teamRuntime = createTeamRuntime("lead", "lead-id", {
    snapshot: {
      teamId: "test-team",
      leadMemberId: "lead-id",
      policy: {
        maxMembers: 2,
        reviewRequired: false,
        allowBatchDelegation: true,
        autoApplyCleanChanges: true,
        implementationProfile: "code",
        reviewProfile: "code",
        researchProfile: "web",
        synthesisProfile: "general",
      },
      members: [],
      tasks: [],
      messages: [],
      approvals: [],
      shutdowns: [],
    },
  });

  const handler = createDelegateHandler(() =>
    Promise.resolve({
      content: "Done",
      toolCalls: [],
    }), {});

  const config = {
    workspace: "/tmp/hlvm-test-member-retire",
    context: new ContextManager(),
    permissionMode: "yolo" as const,
    teamRuntime,
    teamLeadMemberId: "lead-id",
  };

  // Run 2 foreground delegates (fills maxMembers)
  await handler({ agent: "code", task: "task 1" }, config);
  await handler({ agent: "code", task: "task 2" }, config);

  // Both members should be terminated
  const members = teamRuntime.listMembers();
  const workers = members.filter((m) => m.role === "worker");
  assertEquals(workers.length, 2);
  for (const w of workers) {
    assertEquals(w.status, "terminated");
  }

  // A 3rd delegate should still succeed (not blocked by maxMembers)
  const result = await handler({ agent: "code", task: "task 3" }, config);
  assertExists(result);
});

// ============================================================
// Memory Tool Isolation (Phase 1: Policy Coherence)
// ============================================================

Deno.test("CHILD_TOOL_DENYLIST includes memory_write and memory_edit", () => {
  assertEquals(CHILD_TOOL_DENYLIST.includes("memory_write"), true);
  assertEquals(CHILD_TOOL_DENYLIST.includes("memory_edit"), true);
});

Deno.test("CHILD_TOOL_DENYLIST does not include memory_search (read-only)", () => {
  assertEquals(CHILD_TOOL_DENYLIST.includes("memory_search"), false);
});

// ============================================================
// Team Tool Wiring (children can participate in teams)
// ============================================================

Deno.test("agent profiles include team worker tools", async () => {
  const { getAgentProfile } = await import(
    "../../../src/hlvm/agent/agent-registry.ts"
  );
  const teamWorkerTools = [
    "team_task_read",
    "team_task_claim",
    "team_status_read",
    "team_message_send",
    "team_message_read",
    "ack_team_shutdown",
    "submit_team_plan",
  ];

  // All profiles except memory should have team worker tools
  for (const profileName of ["general", "code", "file", "shell", "web"]) {
    const profile = getAgentProfile(profileName);
    assertExists(profile, `Profile ${profileName} not found`);
    for (const tool of teamWorkerTools) {
      assertEquals(
        profile.tools.includes(tool),
        true,
        `Profile "${profileName}" missing team tool "${tool}"`,
      );
    }
  }

  // General profile also gets team_task_write
  const general = getAgentProfile("general");
  assertExists(general);
  assertEquals(general.tools.includes("team_task_write"), true);
});

Deno.test("memory profile does not include team tools", async () => {
  const { getAgentProfile } = await import(
    "../../../src/hlvm/agent/agent-registry.ts"
  );
  const memoryProfile = getAgentProfile("memory");
  assertExists(memoryProfile);
  assertEquals(memoryProfile.tools.includes("team_task_claim"), false);
  assertEquals(memoryProfile.tools.includes("team_status_read"), false);
});

// ============================================================
// Cleanup
// ============================================================
