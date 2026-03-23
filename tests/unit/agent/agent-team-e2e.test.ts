/**
 * End-to-end pipeline tests for multi-agent delegation and team coordination.
 *
 * Each test runs the real runReActLoop with scripted LLM responses
 * and verifies the full tool execution pipeline including events.
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "jsr:@std/assert";
import {
  type LLMFunction,
  runReActLoop,
} from "../../../src/hlvm/agent/orchestrator.ts";
import { createDelegateHandler } from "../../../src/hlvm/agent/delegation.ts";
import { createDelegateInbox } from "../../../src/hlvm/agent/delegate-inbox.ts";
import { createDelegateCoordinationBoard } from "../../../src/hlvm/agent/delegate-coordination.ts";
import {
  getAllThreads,
  resetThreadRegistry,
} from "../../../src/hlvm/agent/delegate-threads.ts";
import {
  resetBatchRegistry,
} from "../../../src/hlvm/agent/delegate-batches.ts";
import { createTeamRuntime } from "../../../src/hlvm/agent/team-runtime.ts";
import { clearAllL1Confirmations } from "../../../src/hlvm/agent/security/safety.ts";
import type { AgentUIEvent } from "../../../src/hlvm/agent/orchestrator.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { createContext, createScriptedLLM } from "./test-helpers.ts";
// Team tools + store + engine imports for E2E team lifecycle tests
import {
  AGENT_TEAM_TOOLS,
} from "../../../src/hlvm/agent/tools/agent-team-tools.ts";
import {
  createTeamStore,
  getActiveTeamStore,
  resetTeamStoreForTests,
  setActiveTeamStore,
  type TaskFile,
} from "../../../src/hlvm/agent/team-store.ts";
import {
  getTeamConfigPath,
  getTeamHighwatermarkPath,
  resetHlvmDirCacheForTests,
} from "../../../src/common/paths.ts";
import {
  type AgentEngine,
  resetAgentEngine,
  setAgentEngine,
} from "../../../src/hlvm/agent/engine.ts";
import type { LLMResponse } from "../../../src/hlvm/agent/tool-call.ts";
import type { AgentProfile } from "../../../src/hlvm/agent/agent-registry.ts";
// TUI pipeline imports — for full E2E: execution → events → reducer → components
import React from "react";
import {
  createTranscriptState,
  reduceTranscriptState,
} from "../../../src/hlvm/cli/agent-transcript-state.ts";
import {
  isStructuredTeamInfoItem,
  StreamingState,
} from "../../../src/hlvm/cli/repl-ink/types.ts";
import { TeamEventItem } from "../../../src/hlvm/cli/repl-ink/components/conversation/TeamEventItem.tsx";
import {
  getTeamTaskStatusGlyph,
  getTeamTaskStatusTone,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/conversation-chrome.ts";
import { buildFooterLeftState } from "../../../src/hlvm/cli/repl-ink/components/FooterHint.tsx";

// ============================================================
// Test helpers
// ============================================================

const platform = getPlatform();

async function waitForBackgroundThreads(): Promise<void> {
  const threads = getAllThreads();
  await Promise.allSettled(threads.map((thread) => thread.promise));
  await Promise.allSettled(threads.map((thread) =>
    thread.workspaceCleanup ? thread.workspaceCleanup() : Promise.resolve()
  ));
}

async function createWorkspace(): Promise<string> {
  const workspace = await platform.fs.makeTempDir({
    prefix: "hlvm-agent-team-e2e-",
  });
  await platform.fs.writeTextFile(
    platform.path.join(workspace, "fixture.txt"),
    "fixture\n",
  );
  return workspace;
}

async function cleanup(workspace?: string): Promise<void> {
  await waitForBackgroundThreads();
  if (workspace) {
    try {
      await platform.fs.remove(workspace, { recursive: true });
    } catch {
      // Best effort cleanup for test fixtures.
    }
  }
  clearAllL1Confirmations();
  resetThreadRegistry();
  resetBatchRegistry();
}

async function withTestWorkspace(
  run: (workspace: string) => Promise<void>,
): Promise<void> {
  await cleanup();
  const workspace = await createWorkspace();
  try {
    await run(workspace);
  } finally {
    await cleanup(workspace);
  }
}

// ============================================================
// Test 1: delegate_agent foreground — full pipeline
// ============================================================

Deno.test({
  name: "E2E pipeline: delegate_agent foreground returns child result to parent",
  async fn() {
    await withTestWorkspace(async (workspace) => {
      // Child LLM: called by runDelegateChild inside createDelegateHandler
      const childLlm = createScriptedLLM([
        { content: "Child found 3 issues in the codebase." },
      ]);

      const parentContext = createContext();
      const events: AgentUIEvent[] = [];

      // Parent LLM: step 1 calls delegate_agent, step 2 produces final answer
      const parentLlm = createScriptedLLM([
        {
          toolCalls: [{
            toolName: "delegate_agent",
            args: { agent: "general", task: "Inspect the codebase for issues" },
          }],
        },
        {
          content: "Based on the delegate result, there are 3 issues found.",
        },
      ]);

      const delegate = createDelegateHandler(childLlm, {});

      const result = await runReActLoop(
        "Find issues in the codebase",
        {
          workspace,
          context: parentContext,
          permissionMode: "yolo",
          maxToolCalls: 5,
          groundingMode: "off",
          delegate,
          onAgentEvent: (event) => events.push(event),
          delegateInbox: createDelegateInbox(),
          coordinationBoard: createDelegateCoordinationBoard(),
        },
        parentLlm,
      );

      assertStringIncludes(result, "3 issues");

      // Verify delegate lifecycle events were emitted
      const delegateStarts = events.filter((e) => e.type === "delegate_start");
      const delegateEnds = events.filter((e) => e.type === "delegate_end");
      assertEquals(delegateStarts.length, 1, "Should have exactly 1 delegate_start event");
      assertEquals(delegateEnds.length, 1, "Should have exactly 1 delegate_end event");
    });
  },
});

// ============================================================
// Test 2: delegate_agent background + inbox drain
// ============================================================

Deno.test({
  name: "E2E pipeline: delegate_agent background returns threadId",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestWorkspace(async (workspace) => {
      const inbox = createDelegateInbox();

      // Child LLM — resolves quickly with result
      const childLlm = createScriptedLLM([
        { content: "Background analysis complete." },
      ]);

      const parentContext = createContext();
      const events: AgentUIEvent[] = [];

      // Parent LLM: step 1 fires background delegate, step 2 produces final answer
      const parentLlm = createScriptedLLM([
        {
          toolCalls: [{
            toolName: "delegate_agent",
            args: {
              agent: "general",
              task: "Run background analysis",
              background: true,
            },
          }],
        },
        {
          content: "Background delegate launched successfully.",
        },
      ]);

      const delegate = createDelegateHandler(childLlm, {});

      const result = await runReActLoop(
        "Launch background analysis",
        {
          workspace,
          context: parentContext,
          permissionMode: "yolo",
          maxToolCalls: 5,
          groundingMode: "off",
          delegate,
          onAgentEvent: (event) => events.push(event),
          delegateInbox: inbox,
          coordinationBoard: createDelegateCoordinationBoard(),
        },
        parentLlm,
      );

      assertStringIncludes(result, "Background delegate launched");

      // Background delegate should have emitted delegate_start with threadId
      const bgStarts = events.filter(
        (e) => e.type === "delegate_start" && "threadId" in e && e.threadId,
      );
      assertEquals(
        bgStarts.length >= 1,
        true,
        "Background delegate should emit delegate_start with threadId",
      );
    });
  },
});

// ============================================================
// Test 3: team_task_write + team_task_claim lifecycle
// ============================================================

Deno.test({
  name: "E2E pipeline: team_task_write and team_task_claim via runReActLoop",
  async fn() {
    await withTestWorkspace(async (workspace) => {
      const runtime = createTeamRuntime("lead", "lead");
      runtime.registerMember({ id: "worker-1", agent: "code" });

      const context = createContext();
      const events: AgentUIEvent[] = [];

      const llm = createScriptedLLM([
        {
          toolCalls: [{
            toolName: "team_task_write",
            args: { id: "task-1", goal: "Implement feature X" },
          }],
        },
        {
          toolCalls: [{
            toolName: "team_task_claim",
            args: { task_id: "task-1" },
          }],
        },
        {
          content: "Task created and claimed successfully.",
        },
      ]);

      const result = await runReActLoop(
        "Create and claim a task",
        {
          workspace,
          context,
          permissionMode: "yolo",
          maxToolCalls: 5,
          groundingMode: "off",
          teamRuntime: runtime,
          teamMemberId: "lead",
          teamLeadMemberId: "lead",
          onAgentEvent: (event) => events.push(event),
          delegateInbox: createDelegateInbox(),
        },
        llm,
      );

      assertStringIncludes(result, "claimed");

      // Verify task was created and claimed
      const task = runtime.getTask("task-1");
      assertExists(task, "Task should exist");
      assertEquals(task.status, "claimed");

      // Verify team_task_updated events were emitted
      const taskUpdatedEvents = events.filter((e) => e.type === "team_task_updated");
      assertEquals(
        taskUpdatedEvents.length >= 2,
        true,
        "Should have team_task_updated events for write and claim",
      );
    });
  },
});

// ============================================================
// Test 4: submit_team_plan + review_team_plan approval flow
// ============================================================

Deno.test({
  name: "E2E pipeline: submit_team_plan and review_team_plan approval flow",
  async fn() {
    await withTestWorkspace(async (workspace) => {
      const runtime = createTeamRuntime("lead", "lead");
      runtime.registerMember({ id: "worker-1", agent: "code" });
      runtime.ensureTask({
        id: "task-review",
        goal: "Implement auth module",
        status: "in_progress",
        assigneeMemberId: "worker-1",
      });

      const context = createContext();
      const events: AgentUIEvent[] = [];
      let capturedApprovalId: string | undefined;

      // Fully custom LLM that dynamically captures approval ID from tool results
      let callCount = 0;
      const llm: LLMFunction = (messages, signal) => {
        if (signal?.aborted) {
          const err = new Error("LLM aborted");
          err.name = "AbortError";
          throw err;
        }
        callCount++;

        if (callCount === 1) {
          // Step 1: submit the plan
          return Promise.resolve({
            content: "",
            toolCalls: [{
              toolName: "submit_team_plan",
              args: {
                task_id: "task-review",
                plan: { steps: ["step 1", "step 2"] },
                note: "Please review my plan",
              },
            }],
          });
        }

        if (callCount === 2) {
          // Step 2: extract approval ID from tool result and review it
          // Search all messages for the approval ID pattern
          for (let i = messages.length - 1; i >= 0; i--) {
            const content = messages[i].content;
            if (content) {
              const match = content.match(/"id"\s*:\s*"([^"]+)"/);
              if (match) {
                capturedApprovalId = match[1];
                break;
              }
            }
          }
          if (capturedApprovalId) {
            return Promise.resolve({
              content: "",
              toolCalls: [{
                toolName: "review_team_plan",
                args: {
                  approval_id: capturedApprovalId,
                  approved: true,
                  feedback: "Looks good!",
                },
              }],
            });
          }
          // Fallback if we couldn't find it
          return Promise.resolve({
            content: "Could not find approval ID.",
            toolCalls: [],
          });
        }

        // Step 3: final answer
        return Promise.resolve({
          content: "Plan submitted and approved.",
          toolCalls: [],
        });
      };

      const result = await runReActLoop(
        "Submit and review a plan",
        {
          workspace,
          context,
          permissionMode: "yolo",
          maxToolCalls: 5,
          groundingMode: "off",
          teamRuntime: runtime,
          teamMemberId: "lead",
          teamLeadMemberId: "lead",
          onAgentEvent: (event) => events.push(event),
          delegateInbox: createDelegateInbox(),
        },
        llm,
      );

      assertStringIncludes(result, "approved");

      // Verify approval lifecycle events
      const reviewRequired = events.filter((e) => e.type === "team_plan_review_required");
      const reviewResolved = events.filter((e) => e.type === "team_plan_review_resolved");
      assertEquals(reviewRequired.length, 1, "Should have team_plan_review_required event");
      assertEquals(reviewResolved.length, 1, "Should have team_plan_review_resolved event");

      // Verify the approval was actually resolved
      assertExists(capturedApprovalId, "Should have captured approval ID from tool result");
      const approval = runtime.getApproval(capturedApprovalId!);
      assertExists(approval, "Approval should exist");
      assertEquals(approval.status, "approved");
    });
  },
});

// ============================================================
// Test 5: batch_delegate fan-out
// ============================================================

Deno.test({
  name: "E2E pipeline: batch_delegate registers batch and spawns threads",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestWorkspace(async (workspace) => {
      const inbox = createDelegateInbox();

      // Child LLM — each batch child gets a fresh call (background, so fire-and-forget)
      const childLlm: LLMFunction = () => {
        return Promise.resolve({
          content: "Processed item.",
          toolCalls: [],
        });
      };

      const parentContext = createContext();
      const events: AgentUIEvent[] = [];

      // Use a custom LLM that verifies the batch result in the second call
      let batchToolResultContent = "";
      let callCount = 0;
      const parentLlm: LLMFunction = (messages, signal) => {
        if (signal?.aborted) {
          const err = new Error("LLM aborted");
          err.name = "AbortError";
          throw err;
        }
        callCount++;

        if (callCount === 1) {
          return Promise.resolve({
            content: "",
            toolCalls: [{
              toolName: "batch_delegate",
              args: {
                agent: "general",
                task_template: "Process {{item}}",
                data: [{ item: "a" }, { item: "b" }, { item: "c" }],
              },
            }],
          });
        }

        // Capture the tool result from the batch
        if (callCount === 2) {
          const lastMsg = messages[messages.length - 1];
          if (lastMsg?.content) {
            batchToolResultContent = lastMsg.content;
          }
        }

        return Promise.resolve({
          content: "Batch delegation completed with 3 items.",
          toolCalls: [],
        });
      };

      const delegate = createDelegateHandler(childLlm, {});

      const result = await runReActLoop(
        "Process items in batch",
        {
          workspace,
          context: parentContext,
          permissionMode: "yolo",
          maxToolCalls: 5,
          groundingMode: "off",
          delegate,
          onAgentEvent: (event) => events.push(event),
          delegateInbox: inbox,
          coordinationBoard: createDelegateCoordinationBoard(),
        },
        parentLlm,
      );

      assertStringIncludes(result, "3 items");

      // Verify batch tool result contains totalRows: 3 and threadIds
      assertStringIncludes(
        batchToolResultContent,
        "totalRows",
        "Batch result should contain totalRows",
      );
      assertStringIncludes(
        batchToolResultContent,
        "threadIds",
        "Batch result should contain threadIds",
      );

      // Verify batch_progress_updated event was emitted
      const batchEvents = events.filter((e) => e.type === "batch_progress_updated");
      assertEquals(
        batchEvents.length >= 1,
        true,
        "Should have at least 1 batch_progress_updated event",
      );
    });
  },
});

// ============================================================
// Test 6: fork_with_history + parent approval forwarding
// ============================================================

Deno.test({
  name: "E2E pipeline: fork_with_history copies parent messages, yolo downgrades to default",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestWorkspace(async (workspace) => {
      // Track what the child sees
      let childMessagesSnapshot: Array<{ role: string; content: string }> = [];

      // Child LLM: captures messages it receives for verification
      const childLlm: LLMFunction = (messages) => {
        childMessagesSnapshot = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        return Promise.resolve({
          content: "Child completed with parent context.",
          toolCalls: [],
        });
      };

      const parentContext = createContext();
      // Add parent conversation messages that should be forked
      parentContext.addMessage({
        role: "user",
        content: "Here is the project requirement: build auth module",
      });
      parentContext.addMessage({
        role: "assistant",
        content: "I will analyze the requirements and delegate to a specialist.",
      });

      const events: AgentUIEvent[] = [];

      const parentLlm = createScriptedLLM([
        {
          toolCalls: [{
            toolName: "delegate_agent",
            args: {
              agent: "general",
              task: "Continue working on auth module",
              fork_with_history: true,
            },
          }],
        },
        {
          content: "Delegate completed with forked context.",
        },
      ]);

      const delegate = createDelegateHandler(childLlm, {});

      // Use "yolo" permission mode — should be downgraded to "default" for child
      const result = await runReActLoop(
        "Delegate with history",
        {
          workspace,
          context: parentContext,
          permissionMode: "yolo",
          maxToolCalls: 5,
          groundingMode: "off",
          delegate,
          onAgentEvent: (event) => events.push(event),
          delegateInbox: createDelegateInbox(),
          coordinationBoard: createDelegateCoordinationBoard(),
        },
        parentLlm,
      );

      assertStringIncludes(result, "forked context");

      // Verify fork-with-history: child should see parent's non-system messages
      const childUserMessages = childMessagesSnapshot.filter(
        (m) => m.role === "user" && m.content.includes("project requirement"),
      );
      assertEquals(
        childUserMessages.length >= 1,
        true,
        "Child should see parent's user message about project requirement (fork-with-history)",
      );

      const childAssistantMessages = childMessagesSnapshot.filter(
        (m) =>
          m.role === "assistant" && m.content.includes("analyze the requirements"),
      );
      assertEquals(
        childAssistantMessages.length >= 1,
        true,
        "Child should see parent's assistant message (fork-with-history)",
      );
    });
  },
});

// ============================================================
// Agent Teams E2E — Full Tool Pipeline Tests
// ============================================================
//
// These tests exercise the complete agent teams flow from a real
// user's perspective: team creation → task creation → teammate
// spawning → task execution → shutdown → cleanup.

// ── Team E2E helpers ──

/** Standard agent profiles for tests — includes general-purpose. */
const TEST_AGENT_PROFILES: readonly AgentProfile[] = [
  { name: "general-purpose", description: "General purpose agent", tools: [] },
];

/** Fast idle polling options for tests — avoids 90s idle waits. */
const FAST_POLL = { idlePollIntervalMs: 10, maxIdlePolls: 3 };

/**
 * Creates a mock AgentEngine. By default returns text-only responses.
 * Pass `failWith` to make the LLM throw on every call.
 */
function createMockEngine(
  options?: { responseText?: string; failWith?: string },
): AgentEngine {
  const text = options?.responseText ?? "Task completed successfully.";
  return {
    createLLM: () =>
      async (): Promise<LLMResponse> => {
        if (options?.failWith) throw new Error(options.failWith);
        return { content: text, toolCalls: [] };
      },
    createSummarizer: () => async () => "Summary",
  };
}

/**
 * Test harness for agent team E2E tests.
 * Encapsulates setup/teardown, team creation, task management, and worker spawning.
 */
class TestHarness {
  readonly dir: string;

  constructor() {
    const tmpDir = getPlatform().path.join(
      getPlatform().env.get("TMPDIR") || "/tmp",
      `hlvm-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    getPlatform().fs.mkdirSync(tmpDir, { recursive: true });
    this.dir = tmpDir;
    getPlatform().env.set("HLVM_DIR", tmpDir);
    resetHlvmDirCacheForTests();
    resetTeamStoreForTests();
    resetThreadRegistry();
    resetBatchRegistry();
  }

  async spawnTeam(name: string, description?: string): Promise<Record<string, unknown>> {
    return await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "spawnTeam", team_name: name, description },
      this.dir,
    ) as Record<string, unknown>;
  }

  async createTask(subject: string, description: string): Promise<Record<string, unknown>> {
    return await AGENT_TEAM_TOOLS.TaskCreate.fn(
      { subject, description },
      this.dir,
    ) as Record<string, unknown>;
  }

  async updateTask(taskId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return await AGENT_TEAM_TOOLS.TaskUpdate.fn(
      { taskId, ...patch },
      this.dir,
    ) as Record<string, unknown>;
  }

  async spawnWorker(
    name: string,
    engineOrOptions?: AgentEngine | { failWith: string },
    extra?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const engine = engineOrOptions && "failWith" in engineOrOptions
      ? createMockEngine(engineOrOptions)
      : (engineOrOptions as AgentEngine | undefined) ?? createMockEngine();
    setAgentEngine(engine);
    return await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "spawnAgent", name, agent_type: "general-purpose", ...extra },
      this.dir,
      { agentProfiles: TEST_AGENT_PROFILES, ...FAST_POLL, ...extra } as any,
    ) as Record<string, unknown>;
  }

  async waitForThreads(): Promise<void> {
    await waitForBackgroundThreads();
  }

  store(): import("../../../src/hlvm/agent/team-store.ts").TeamStore {
    return getActiveTeamStore()!;
  }

  async cleanupTeam(): Promise<Record<string, unknown>> {
    return await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "cleanup" },
      this.dir,
    ) as Record<string, unknown>;
  }

  teardown(): void {
    setActiveTeamStore(null);
    resetAgentEngine();
    resetThreadRegistry();
    resetBatchRegistry();
    getPlatform().env.delete("HLVM_DIR");
    resetHlvmDirCacheForTests();
    resetTeamStoreForTests();
    try {
      getPlatform().fs.removeSync(this.dir, { recursive: true });
    } catch { /* best effort */ }
  }
}

// ============================================================
// Test 7: Full Team Lifecycle — spawnTeam + TaskCreate + spawnAgent + completion + cleanup
// ============================================================

Deno.test({
  name: "E2E team: full lifecycle — spawnTeam → TaskCreate → spawnAgent → completion → cleanup",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const h = new TestHarness();
    try {
      const teamResult = await h.spawnTeam("e2e-lifecycle", "Lifecycle test");
      assertEquals(teamResult.status, "created");
      assertExists(getActiveTeamStore());

      const taskResult = await h.createTask("Write tests", "Add unit tests for auth module");
      assertEquals(taskResult.id, "1");

      const spawnResult = await h.spawnWorker("worker-1");
      assertEquals(spawnResult.status, "spawned");
      assertExists(spawnResult.threadId);
      await h.waitForThreads();

      const task = await h.store().getTask("1");
      assertExists(task);
      assertEquals(task!.status, "completed");
      assertEquals(task!.owner, "worker-1");

      const snapshot = h.store().runtime.snapshot();
      assertEquals(snapshot.messages.some((m) => m.kind === "task_completed"), true);
      assertEquals(snapshot.messages.some((m) => m.kind === "idle_notification"), true);
      assertEquals(h.store().runtime.getMember("worker-1")?.status, "terminated");

      const cleanupResult = await h.cleanupTeam();
      assertEquals(cleanupResult.status, "cleaned_up");
      assertEquals(getActiveTeamStore(), null);
    } finally {
      h.teardown();
    }
  },
});

// ============================================================
// Test 8: Multi-Teammate Parallel Execution
// ============================================================

Deno.test({
  name: "E2E team: two teammates pick up two tasks in parallel",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const h = new TestHarness();
    try {
      await h.spawnTeam("e2e-parallel");
      await h.createTask("Task Alpha", "Do alpha work");
      await h.createTask("Task Beta", "Do beta work");

      await h.spawnWorker("worker-a");
      await h.spawnWorker("worker-b");
      await h.waitForThreads();

      const tasks = await h.store().listTasks();
      assertEquals(tasks.length, 2);
      for (const t of tasks) assertEquals(t.status, "completed");
      assertEquals(tasks.map((t) => t.owner).filter(Boolean).length, 2);

      const snapshot = h.store().runtime.snapshot();
      assertEquals(snapshot.messages.filter((m) => m.kind === "task_completed").length >= 2, true);
    } finally {
      h.teardown();
    }
  },
});

// ============================================================
// Test 9: Blocked Task Ordering — Dependencies Respected
// ============================================================

Deno.test({
  name: "E2E team: teammate respects blockedBy ordering — completes blocker before blocked",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const h = new TestHarness();
    try {
      await h.spawnTeam("e2e-blocked");
      await h.createTask("Setup infrastructure", "Set up DB and env");
      await h.createTask("Build feature", "Build the feature on top of infra");
      await h.updateTask("2", { addBlockedBy: ["1"] });

      await h.spawnWorker("solo-worker");
      await h.waitForThreads();

      const taskA = await h.store().getTask("1");
      const taskB = await h.store().getTask("2");
      assertExists(taskA);
      assertExists(taskB);
      assertEquals(taskA!.status, "completed");
      assertEquals(taskB!.status, "completed");
      assertEquals(taskA!.owner, "solo-worker");
      assertEquals(taskB!.owner, "solo-worker");

      const snapshot = h.store().runtime.snapshot();
      assertEquals(snapshot.messages.filter((m) => m.kind === "task_completed").length, 2);
    } finally {
      h.teardown();
    }
  },
});

// ============================================================
// Test 10: Shutdown Protocol via Inbox
// ============================================================

Deno.test({
  name: "E2E team: shutdown_request via inbox terminates teammate",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const h = new TestHarness();
    try {
      await h.spawnTeam("e2e-shutdown");

      // Pre-populate inbox with shutdown request before spawning
      await h.store().sendMessage({
        id: "shutdown-msg",
        type: "shutdown_request",
        from: "lead",
        content: "All work done, please shut down",
        summary: "Shutdown",
        timestamp: Date.now(),
        recipient: "shutdown-worker",
        requestId: "shutdown-req-1",
      });

      await h.spawnWorker("shutdown-worker");
      await h.waitForThreads();

      assertEquals(h.store().runtime.getMember("shutdown-worker")?.status, "terminated");
    } finally {
      h.teardown();
    }
  },
});

// ============================================================
// Test 11: Teammate Receives DM via Inbox
// ============================================================

Deno.test({
  name: "E2E team: teammate drains inbox DM, then completes task",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const h = new TestHarness();
    try {
      await h.spawnTeam("e2e-inbox");
      await h.createTask("Process data", "Parse and transform the data");

      // Pre-populate inbox with a DM before spawning
      await h.store().sendMessage({
        id: "pre-dm-1",
        type: "message",
        from: "lead",
        content: "Here is some context for the task",
        summary: "Context info",
        timestamp: Date.now(),
        recipient: "inbox-worker",
      });

      await h.spawnWorker("inbox-worker");
      await h.waitForThreads();

      const task = await h.store().getTask("1");
      assertExists(task);
      assertEquals(task!.status, "completed");
      assertEquals(task!.owner, "inbox-worker");
      assertEquals((await h.store().readInbox("inbox-worker")).length, 0);
    } finally {
      h.teardown();
    }
  },
});

// ============================================================
// Test 12: Teammate Error Handling — Task Fails
// ============================================================

Deno.test({
  name: "E2E team: teammate handles LLM error gracefully — task stays in_progress",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const h = new TestHarness();
    try {
      await h.spawnTeam("e2e-error");
      await h.createTask("Failing task", "This will fail");

      await h.spawnWorker("error-worker", { failWith: "Simulated LLM failure" });
      await h.waitForThreads();

      const task = await h.store().getTask("1");
      assertExists(task);
      assertEquals(task!.status, "in_progress");

      // Verify task_error notification
      const snapshot = h.store().runtime.snapshot();
      const errorMsgs = snapshot.messages.filter((m) => {
        if (m.kind !== "task_completed") return false;
        try { return JSON.parse(m.content).type === "task_error"; } catch { return false; }
      });
      assertEquals(errorMsgs.length >= 1, true, "Should have task_error message");
      assertEquals(h.store().runtime.getMember("error-worker")?.status, "terminated");
    } finally {
      h.teardown();
    }
  },
});

// ============================================================
// Test 13: Highwatermark Survives Through spawnAgent Flow
// ============================================================

Deno.test({
  name: "E2E team: task ID highwatermark persists across store recreation",
  async fn() {
    const h = new TestHarness();
    try {
      await h.spawnTeam("e2e-highwatermark");
      await h.createTask("A", "a");
      await h.createTask("B", "b");
      await h.createTask("C", "c");

      const tasks = await h.store().listTasks();
      assertEquals(tasks.map((t) => t.id), ["1", "2", "3"]);

      const hwPath = getTeamHighwatermarkPath("e2e-highwatermark");
      assertEquals(getPlatform().fs.readTextFileSync(hwPath), "3");

      // Reset and recreate store (simulating restart)
      setActiveTeamStore(null);
      resetTeamStoreForTests();
      const store2 = await createTeamStore("e2e-highwatermark");
      setActiveTeamStore(store2);

      const newTask = await h.createTask("D", "d");
      assertEquals(newTask.id, "4");
    } finally {
      h.teardown();
    }
  },
});

// ============================================================
// Test 14: Config.json Reflects Spawned Teammates
// ============================================================

Deno.test({
  name: "E2E team: config.json includes spawned teammate metadata",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const h = new TestHarness();
    try {
      await h.spawnTeam("e2e-config");
      await h.createTask("Quick task", "...");

      await h.spawnWorker("config-worker", undefined, { plan_mode_required: true });
      await h.waitForThreads();

      const configPath = getTeamConfigPath("e2e-config");
      const config = JSON.parse(getPlatform().fs.readTextFileSync(configPath));

      assertEquals(config.members.length >= 2, true, "Config should have at least 2 members");
      const worker = config.members.find(
        (m: Record<string, unknown>) => m.name === "config-worker",
      );
      assertExists(worker, "Config should include config-worker member");
      assertEquals(worker.agentType, "general-purpose");
      assertExists(worker.joinedAt);
      assertEquals(worker.backendType, "in-process");
    } finally {
      h.teardown();
    }
  },
});

// ============================================================
// Test 15: TRUE E2E — scripted agent does REAL work via tool calls,
// events flow through reducer to TUI components and footer.
//
// This proves: "spawn agents and get job done" actually works.
// The scripted LLM calls TaskCreate (creates a real sub-task in the
// store) — verifiable side effect that proves the orchestrator
// executed the tool, not just returned a canned string.
// ============================================================

Deno.test({
  name: "E2E team: agent does real work via tool calls, events flow through reducer to TUI",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const h = new TestHarness();
    try {
      await h.spawnTeam("e2e-real-work", "Real work test");
      await h.createTask("Build auth module", "Implement authentication");

      // Script LLM: first task makes a real TaskCreate call, subsequent tasks complete immediately
      const capturedEvents: AgentUIEvent[] = [];
      let llmCallCount = 0;
      setAgentEngine({
        createLLM: () => {
          llmCallCount++;
          if (llmCallCount === 1) {
            return createScriptedLLM([
              {
                content: "I'll break this down. Creating a sub-task for test coverage.",
                toolCalls: [{
                  id: "tc-1",
                  toolName: "TaskCreate",
                  args: { subject: "Write auth tests", description: "Unit tests for login, logout, token refresh" },
                }],
              },
              { content: "Auth module implemented and sub-task created for tests.", toolCalls: [] },
            ]);
          }
          return createScriptedLLM([{ content: "Sub-task completed.", toolCalls: [] }]);
        },
        createSummarizer: () => async () => "Summary",
      });

      await AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnAgent", name: "alice", agent_type: "general-purpose" },
        h.dir,
        { agentProfiles: TEST_AGENT_PROFILES, ...FAST_POLL, onAgentEvent: (event: AgentUIEvent) => capturedEvents.push(event) } as any,
      );
      await h.waitForThreads();

      // Verify REAL side effect: sub-task created by agent's tool call
      const tasks = await h.store().listTasks();
      assertEquals(tasks.length, 2, `Should have 2 tasks (original + sub-task), got ${tasks.length}`);
      const subTask = tasks.find((t) => t.subject === "Write auth tests");
      assertExists(subTask, "Agent should have created 'Write auth tests' sub-task");
      assertStringIncludes(subTask!.description, "login");

      const mainTask = await h.store().getTask("1");
      assertExists(mainTask);
      assertEquals(mainTask!.status, "completed");
      assertEquals(mainTask!.owner, "alice");

      // Verify events
      const eventTypes = capturedEvents.map((e) => e.type);
      assertEquals(eventTypes.includes("team_task_updated"), true);
      assertEquals(eventTypes.includes("tool_start") || eventTypes.includes("tool_end"), true);

      // Feed events through REAL reducer
      let transcriptState = createTranscriptState();
      for (const event of capturedEvents) {
        transcriptState = reduceTranscriptState(transcriptState, { type: "agent_event", event });
      }

      const teamItems = transcriptState.items.filter(isStructuredTeamInfoItem);
      assertEquals(teamItems.length >= 2, true, `Expected >= 2 team items, got ${teamItems.length}`);

      const taskUpdates = teamItems.filter((i) => i.teamEventType === "team_task_updated");
      assertEquals(taskUpdates.length >= 2, true);
      assertExists(taskUpdates.find((i) => i.teamEventType === "team_task_updated" && i.status === "in_progress"));
      assertExists(taskUpdates.find((i) => i.teamEventType === "team_task_updated" && i.status === "completed"));

      // Verify chrome + component integration
      for (const item of taskUpdates) {
        if (item.teamEventType !== "team_task_updated") continue;
        const tone = getTeamTaskStatusTone(item.status);
        assertEquals(["neutral", "active", "success", "warning", "error"].includes(tone), true);
        assertEquals(getTeamTaskStatusGlyph(item.status).length > 0, true);
      }
      for (const item of teamItems) {
        const el = React.createElement(TeamEventItem, { item, width: 80 });
        assertExists(el);
      }

      // Verify footer state
      const footerState = buildFooterLeftState({
        inConversation: true, streamingState: StreamingState.Idle, teamActive: true,
        teamAttentionCount: teamItems.length, teamWorkerSummary: "alice: working", spinner: "x",
      });
      assertExists(footerState.segments.find((s) => s.text === "Team"));
      assertExists(footerState.segments.find((s) => s.text.includes("alice")));

      await h.cleanupTeam();
    } finally {
      h.teardown();
    }
  },
});

// ============================================================
// Test 16: Teammate writes a file (L1 tool) — proves permission inheritance
// ============================================================

Deno.test({
  name: "E2E team: teammate writes file (L1) with inherited auto-edit permission",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const h = new TestHarness();
    const workspace = await platform.fs.makeTempDir({ prefix: "hlvm-team-write-" });
    try {
      await h.spawnTeam("e2e-write-file", "File write test");
      await h.createTask("Create config file", "Write a config.json to workspace");

      // Script LLM to call write_file (L1 — requires auto-edit permission)
      const targetPath = platform.path.join(workspace, "config.json");
      const fileContent = JSON.stringify({ version: 1, name: "test-app" }, null, 2);
      const capturedEvents: AgentUIEvent[] = [];

      setAgentEngine({
        createLLM: () => createScriptedLLM([
          {
            content: "Creating config file.",
            toolCalls: [{ id: "tc-write", toolName: "write_file", args: { path: targetPath, content: fileContent } }],
          },
          { content: "Config file created successfully.", toolCalls: [] },
        ]),
        createSummarizer: () => async () => "Summary",
      });

      const writeProfiles: readonly AgentProfile[] = [
        { name: "general", description: "General purpose agent", tools: ["write_file"] },
      ];
      await AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnAgent", name: "writer", agent_type: "general-purpose" },
        workspace,
        { agentProfiles: writeProfiles, ...FAST_POLL, onAgentEvent: (event: AgentUIEvent) => capturedEvents.push(event), permissionMode: "auto-edit" } as any,
      );
      await h.waitForThreads();

      // Verify file was ACTUALLY written to disk
      const written = await platform.fs.readTextFile(targetPath);
      assertStringIncludes(written, "test-app");
      assertStringIncludes(written, "version");

      const task = await h.store().getTask("1");
      assertExists(task);
      assertEquals(task!.status, "completed");
      assertEquals(task!.owner, "writer");

      assertExists(
        capturedEvents.filter((e) => e.type === "tool_start").find((e) => (e as Record<string, unknown>).name === "write_file"),
        "Should have tool_start event for write_file",
      );

      await h.cleanupTeam();
    } finally {
      try { await platform.fs.remove(workspace, { recursive: true }); } catch { /* best effort */ }
      h.teardown();
    }
  },
});
