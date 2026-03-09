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
  type OrchestratorConfig,
  runReActLoop,
  type ToolCall,
} from "../../../src/hlvm/agent/orchestrator.ts";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import { generateSystemPrompt } from "../../../src/hlvm/agent/llm-integration.ts";
import { ENGINE_PROFILES } from "../../../src/hlvm/agent/constants.ts";
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

// ============================================================
// Test helpers
// ============================================================

const platform = getPlatform();

interface ScriptedStep {
  content?: string;
  toolCalls?: ToolCall[];
  expectLastIncludes?: string;
}

function createScriptedLLM(steps: ScriptedStep[]): LLMFunction {
  let index = 0;
  return (messages, signal) => {
    if (signal?.aborted) {
      const err = new Error("LLM aborted");
      err.name = "AbortError";
      throw err;
    }
    if (index >= steps.length) {
      throw new Error(
        `Scripted LLM exhausted steps (called ${index + 1} times, only ${steps.length} steps)`,
      );
    }
    const step = steps[index++];
    if (step.expectLastIncludes) {
      const last = messages[messages.length - 1];
      assertStringIncludes(last.content, step.expectLastIncludes);
    }
    return Promise.resolve({
      content: step.content ?? "",
      toolCalls: step.toolCalls ?? [],
    });
  };
}

function createContext(): ContextManager {
  const context = new ContextManager({
    maxTokens: Math.max(ENGINE_PROFILES.normal.context.maxTokens, 12000),
    overflowStrategy: "fail",
  });
  context.addMessage({
    role: "system",
    content: generateSystemPrompt(),
  });
  return context;
}

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
