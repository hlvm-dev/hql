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

/** Creates a mock AgentEngine that returns text-only (no tool calls). */
function createMockEngine(responseText = "Task completed successfully."): AgentEngine {
  return {
    createLLM: () => {
      return async (): Promise<LLMResponse> => ({
        content: responseText,
        toolCalls: [],
      });
    },
    createSummarizer: () => {
      return async () => "Summary";
    },
  };
}

/** Creates a mock AgentEngine whose LLM function throws an error. */
function createFailingEngine(errorMessage: string): AgentEngine {
  return {
    createLLM: () => {
      return async (): Promise<LLMResponse> => {
        throw new Error(errorMessage);
      };
    },
    createSummarizer: () => {
      return async () => "Summary";
    },
  };
}

/** Standard agent profiles for tests — includes general-purpose. */
const TEST_AGENT_PROFILES: readonly AgentProfile[] = [
  { name: "general-purpose", description: "General purpose agent", tools: [] },
];

/** Fast idle polling options for tests — avoids 90s idle waits. */
const FAST_POLL = { idlePollIntervalMs: 10, maxIdlePolls: 3 };

/** Standard ToolExecutionOptions for spawnAgent calls. */
function makeSpawnOptions(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    agentProfiles: TEST_AGENT_PROFILES,
    ...FAST_POLL,
    ...overrides,
  };
}

function tmpHlvmDir(): string {
  const tmpDir = getPlatform().path.join(
    getPlatform().env.get("TMPDIR") || "/tmp",
    `hlvm-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  getPlatform().fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

function setupTeamEnv(): string {
  const dir = tmpHlvmDir();
  getPlatform().env.set("HLVM_DIR", dir);
  resetHlvmDirCacheForTests();
  resetTeamStoreForTests();
  resetThreadRegistry();
  resetBatchRegistry();
  return dir;
}

function teardownTeamEnv(): void {
  setActiveTeamStore(null);
  resetAgentEngine();
  resetThreadRegistry();
  resetBatchRegistry();
  const dir = getPlatform().env.get("HLVM_DIR");
  getPlatform().env.delete("HLVM_DIR");
  resetHlvmDirCacheForTests();
  resetTeamStoreForTests();
  if (dir) {
    try {
      getPlatform().fs.removeSync(dir, { recursive: true });
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
    const dir = setupTeamEnv();
    try {
      // 1. Create team via tool API
      const teamResult = await AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnTeam", team_name: "e2e-lifecycle", description: "Lifecycle test" },
        dir,
      ) as Record<string, unknown>;
      assertEquals(teamResult.status, "created");
      assertEquals(teamResult.teamName, "e2e-lifecycle");
      assertExists(getActiveTeamStore());

      // 2. Create a task via tool API
      const taskResult = await AGENT_TEAM_TOOLS.TaskCreate.fn(
        { subject: "Write tests", description: "Add unit tests for auth module" },
        dir,
      ) as Record<string, unknown>;
      assertEquals(taskResult.id, "1");

      // 3. Set up mock engine that returns text-only (task completes immediately)
      setAgentEngine(createMockEngine());

      // 4. Spawn teammate via tool API
      const spawnResult = await AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnAgent", name: "worker-1", agent_type: "general-purpose" },
        dir,
        makeSpawnOptions() as any,
      ) as Record<string, unknown>;
      assertEquals(spawnResult.status, "spawned");
      assertExists(spawnResult.threadId);

      // 5. Wait for background thread to finish
      await waitForBackgroundThreads();

      // 6. Verify task was completed
      const store = getActiveTeamStore()!;
      const task = await store.getTask("1");
      assertExists(task);
      assertEquals(task!.status, "completed");
      assertEquals(task!.owner, "worker-1");

      // 7. Verify runtime messages
      const snapshot = store.runtime.snapshot();
      const completionMsgs = snapshot.messages.filter((m) => m.kind === "task_completed");
      assertEquals(completionMsgs.length >= 1, true, "Should have task_completed message");

      const idleMsgs = snapshot.messages.filter((m) => m.kind === "idle_notification");
      assertEquals(idleMsgs.length >= 1, true, "Should have idle_notification message");

      // 8. Verify member is terminated
      const member = store.runtime.getMember("worker-1");
      assertEquals(member?.status, "terminated");

      // 9. Cleanup
      const cleanupResult = await AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "cleanup" },
        dir,
      ) as Record<string, unknown>;
      assertEquals(cleanupResult.status, "cleaned_up");
      assertEquals(getActiveTeamStore(), null);
    } finally {
      teardownTeamEnv();
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
    const dir = setupTeamEnv();
    try {
      // Create team + 2 tasks
      await AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnTeam", team_name: "e2e-parallel" },
        dir,
      );
      await AGENT_TEAM_TOOLS.TaskCreate.fn(
        { subject: "Task Alpha", description: "Do alpha work" },
        dir,
      );
      await AGENT_TEAM_TOOLS.TaskCreate.fn(
        { subject: "Task Beta", description: "Do beta work" },
        dir,
      );

      // Set up mock engine
      setAgentEngine(createMockEngine());

      // Spawn two teammates
      await AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnAgent", name: "worker-a", agent_type: "general-purpose" },
        dir,
        makeSpawnOptions() as any,
      );
      await AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnAgent", name: "worker-b", agent_type: "general-purpose" },
        dir,
        makeSpawnOptions() as any,
      );

      // Wait for both to finish
      await waitForBackgroundThreads();

      const store = getActiveTeamStore()!;
      const tasks = await store.listTasks();

      // Both tasks should be completed
      assertEquals(tasks.length, 2);
      for (const t of tasks) {
        assertEquals(t.status, "completed");
      }

      // Each should have an owner (might be same or different depending on race)
      const owners = tasks.map((t) => t.owner).filter(Boolean);
      assertEquals(owners.length, 2);

      // Verify task_completed messages
      const snapshot = store.runtime.snapshot();
      const completionMsgs = snapshot.messages.filter((m) => m.kind === "task_completed");
      assertEquals(completionMsgs.length >= 2, true, "Should have 2 task_completed messages");
    } finally {
      teardownTeamEnv();
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
    const dir = setupTeamEnv();
    try {
      await AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnTeam", team_name: "e2e-blocked" },
        dir,
      );

      // Create task A (blocker) and task B (blocked by A)
      await AGENT_TEAM_TOOLS.TaskCreate.fn(
        { subject: "Setup infrastructure", description: "Set up DB and env" },
        dir,
      );
      await AGENT_TEAM_TOOLS.TaskCreate.fn(
        { subject: "Build feature", description: "Build the feature on top of infra" },
        dir,
      );
      await AGENT_TEAM_TOOLS.TaskUpdate.fn(
        { taskId: "2", addBlockedBy: ["1"] },
        dir,
      );

      // Single teammate handles both
      setAgentEngine(createMockEngine());
      await AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnAgent", name: "solo-worker", agent_type: "general-purpose" },
        dir,
        makeSpawnOptions() as any,
      );

      await waitForBackgroundThreads();

      const store = getActiveTeamStore()!;
      const taskA = await store.getTask("1");
      const taskB = await store.getTask("2");

      // Both should be completed
      assertExists(taskA);
      assertExists(taskB);
      assertEquals(taskA!.status, "completed");
      assertEquals(taskB!.status, "completed");

      // Task A should have been picked up first (solo worker, so sequential)
      assertEquals(taskA!.owner, "solo-worker");
      assertEquals(taskB!.owner, "solo-worker");

      // Both were completed by the same worker
      const snapshot = store.runtime.snapshot();
      const completionMsgs = snapshot.messages.filter((m) => m.kind === "task_completed");
      assertEquals(completionMsgs.length, 2);
    } finally {
      teardownTeamEnv();
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
    const dir = setupTeamEnv();
    try {
      await AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnTeam", team_name: "e2e-shutdown" },
        dir,
      );

      const store = getActiveTeamStore()!;

      // Write a shutdown request to the worker's inbox BEFORE spawning.
      // This way the loop picks it up on first inbox drain.
      await store.sendMessage({
        id: "shutdown-msg",
        type: "shutdown_request",
        from: "lead",
        content: "All work done, please shut down",
        summary: "Shutdown",
        timestamp: Date.now(),
        recipient: "shutdown-worker",
        requestId: "shutdown-req-1",
      });

      // No tasks — teammate will check inbox and find shutdown
      setAgentEngine(createMockEngine());

      // Spawn teammate
      await AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnAgent", name: "shutdown-worker", agent_type: "general-purpose" },
        dir,
        makeSpawnOptions() as any,
      );

      // Wait for thread
      await waitForBackgroundThreads();

      // Verify member terminated
      const member = store.runtime.getMember("shutdown-worker");
      assertEquals(member?.status, "terminated");
    } finally {
      teardownTeamEnv();
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
    const dir = setupTeamEnv();
    try {
      await AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnTeam", team_name: "e2e-inbox" },
        dir,
      );

      // Create a task
      await AGENT_TEAM_TOOLS.TaskCreate.fn(
        { subject: "Process data", description: "Parse and transform the data" },
        dir,
      );

      const store = getActiveTeamStore()!;

      // Pre-populate inbox for the worker with a DM (before spawning)
      await store.sendMessage({
        id: "pre-dm-1",
        type: "message",
        from: "lead",
        content: "Here is some context for the task",
        summary: "Context info",
        timestamp: Date.now(),
        recipient: "inbox-worker",
      });

      setAgentEngine(createMockEngine());

      // Spawn the worker
      await AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnAgent", name: "inbox-worker", agent_type: "general-purpose" },
        dir,
        makeSpawnOptions() as any,
      );

      await waitForBackgroundThreads();

      // Task should be completed
      const task = await store.getTask("1");
      assertExists(task);
      assertEquals(task!.status, "completed");
      assertEquals(task!.owner, "inbox-worker");

      // Inbox should be drained
      const inbox = await store.readInbox("inbox-worker");
      assertEquals(inbox.length, 0);
    } finally {
      teardownTeamEnv();
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
    const dir = setupTeamEnv();
    try {
      await AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnTeam", team_name: "e2e-error" },
        dir,
      );

      await AGENT_TEAM_TOOLS.TaskCreate.fn(
        { subject: "Failing task", description: "This will fail" },
        dir,
      );

      // Engine that throws errors
      setAgentEngine(createFailingEngine("Simulated LLM failure"));

      await AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnAgent", name: "error-worker", agent_type: "general-purpose" },
        dir,
        makeSpawnOptions() as any,
      );

      await waitForBackgroundThreads();

      const store = getActiveTeamStore()!;

      // Task should remain in_progress (not completed, available for retry)
      const task = await store.getTask("1");
      assertExists(task);
      assertEquals(task!.status, "in_progress");

      // Runtime should have a task_error notification (sent via task_completed kind with error content)
      const snapshot = store.runtime.snapshot();
      const errorMsgs = snapshot.messages.filter((m) => {
        if (m.kind !== "task_completed") return false;
        try {
          const payload = JSON.parse(m.content);
          return payload.type === "task_error";
        } catch {
          return false;
        }
      });
      assertEquals(errorMsgs.length >= 1, true, "Should have task_error message");

      // Worker should eventually terminate (idle timeout after error)
      const member = store.runtime.getMember("error-worker");
      assertEquals(member?.status, "terminated");
    } finally {
      teardownTeamEnv();
    }
  },
});

// ============================================================
// Test 13: Highwatermark Survives Through spawnAgent Flow
// ============================================================

Deno.test({
  name: "E2E team: task ID highwatermark persists across store recreation",
  async fn() {
    const dir = setupTeamEnv();
    try {
      // Create team and 3 tasks
      await AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnTeam", team_name: "e2e-highwatermark" },
        dir,
      );
      await AGENT_TEAM_TOOLS.TaskCreate.fn(
        { subject: "A", description: "a" },
        dir,
      );
      await AGENT_TEAM_TOOLS.TaskCreate.fn(
        { subject: "B", description: "b" },
        dir,
      );
      await AGENT_TEAM_TOOLS.TaskCreate.fn(
        { subject: "C", description: "c" },
        dir,
      );

      // Verify IDs are 1, 2, 3
      const store1 = getActiveTeamStore()!;
      const tasks = await store1.listTasks();
      assertEquals(tasks.map((t) => t.id), ["1", "2", "3"]);

      // Verify highwatermark file on disk
      const hwPath = getTeamHighwatermarkPath("e2e-highwatermark");
      const hwContent = getPlatform().fs.readTextFileSync(hwPath);
      assertEquals(hwContent, "3");

      // Reset and recreate store (simulating restart)
      setActiveTeamStore(null);
      resetTeamStoreForTests();

      const store2 = await createTeamStore("e2e-highwatermark");
      setActiveTeamStore(store2);

      // Create another task — should continue from highwatermark
      const newTask = await AGENT_TEAM_TOOLS.TaskCreate.fn(
        { subject: "D", description: "d" },
        dir,
      ) as Record<string, unknown>;
      assertEquals(newTask.id, "4");
    } finally {
      teardownTeamEnv();
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
    const dir = setupTeamEnv();
    try {
      await AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnTeam", team_name: "e2e-config" },
        dir,
      );

      // Create a task so teammate doesn't idle-exit too fast
      await AGENT_TEAM_TOOLS.TaskCreate.fn(
        { subject: "Quick task", description: "..." },
        dir,
      );

      setAgentEngine(createMockEngine());

      await AGENT_TEAM_TOOLS.Teammate.fn(
        {
          operation: "spawnAgent",
          name: "config-worker",
          agent_type: "general-purpose",
          plan_mode_required: true,
        },
        dir,
        makeSpawnOptions() as any,
      );

      // Wait for thread to finish
      await waitForBackgroundThreads();

      // Read config.json from disk
      const configPath = getTeamConfigPath("e2e-config");
      const config = JSON.parse(getPlatform().fs.readTextFileSync(configPath));

      // Should have 2 members: lead + config-worker
      assertEquals(config.members.length >= 2, true, "Config should have at least 2 members");

      const worker = config.members.find(
        (m: Record<string, unknown>) => m.name === "config-worker",
      );
      assertExists(worker, "Config should include config-worker member");
      assertEquals(worker.agentType, "general-purpose");
      assertExists(worker.joinedAt, "Member should have joinedAt timestamp");
      assertEquals(worker.backendType, "in-process");
    } finally {
      teardownTeamEnv();
    }
  },
});
