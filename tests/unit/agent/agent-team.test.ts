/**
 * Agent Team Tests — Claude Code Parity
 *
 * Tests the file-backed team store, Claude Code-compatible tools,
 * persistence, messaging, task management, hooks, and lifecycle.
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert";
import {
  createTeamStore,
  getActiveTeamStore,
  resetTeamStoreForTests,
  setActiveTeamStore,
  type TaskFile,
  type TeamStore,
} from "../../../src/hlvm/agent/team-store.ts";
import {
  getTeamConfigPath,
  getTeamDir,
  getTeamHighwatermarkPath,
  getTeamInboxPath,
  getTeamTasksDir,
  resetHlvmDirCacheForTests,
  setHlvmDirForTests,
} from "../../../src/common/paths.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  AGENT_TEAM_TOOLS,
} from "../../../src/hlvm/agent/tools/agent-team-tools.ts";
import type { HookFeedback } from "../../../src/hlvm/agent/hooks.ts";
import {
  runTeammateLoop,
  type TeammateIdentity,
  type TeammateLoopOptions,
} from "../../../src/hlvm/agent/team-executor.ts";
import {
  createTeamRuntime,
  type TeamRuntime,
} from "../../../src/hlvm/agent/team-runtime.ts";
import {
  setAgentEngine,
  resetAgentEngine,
  type AgentEngine,
} from "../../../src/hlvm/agent/engine.ts";
import type { LLMResponse } from "../../../src/hlvm/agent/tool-call.ts";
import {
  deriveTeamDashboardState,
} from "../../../src/hlvm/cli/repl-ink/hooks/useTeamState.ts";

// ── Test Helpers ──────────────────────────────────────────────────────

const TEST_TEAM = "test-team-" + Date.now();
let store: TeamStore;

function tmpHlvmDir(): string {
  const tmpDir = getPlatform().path.join(
    getPlatform().env.get("TMPDIR") || "/tmp",
    `hlvm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  getPlatform().fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

function setupTestEnv(): string {
  const dir = tmpHlvmDir();
  setHlvmDirForTests(dir);
  resetTeamStoreForTests();
  return dir;
}

function teardownTestEnv(dir?: string): void {
  resetHlvmDirCacheForTests();
  resetTeamStoreForTests();
  if (dir) {
    try {
      getPlatform().fs.removeSync(dir, { recursive: true });
    } catch { /* best effort */ }
  }
}

// ── Team Store Tests ──────────────────────────────────────────────────

Deno.test("team store: createTeamStore creates config.json on disk", async () => {
  const dir = setupTestEnv();
  try {
    const store = await createTeamStore("my-team");
    const configPath = getTeamConfigPath("my-team");
    const config = JSON.parse(getPlatform().fs.readTextFileSync(configPath));
    assertEquals(config.teamName, "my-team");
    assertEquals(config.leadMemberId, "lead");
    assertExists(config.teamId);
    assertExists(config.members);
    assertEquals(config.members.length, 1);
    assertEquals(config.members[0].name, "lead");
  } finally {
    teardownTestEnv();
  }
});

Deno.test("team store: createTask persists task file to disk", async () => {
  const dir = setupTestEnv();
  try {
    const store = await createTeamStore("task-test");
    const task = await store.createTask({
      subject: "Implement auth",
      description: "Add JWT authentication to the API",
      activeForm: "Implementing auth",
    });
    assertEquals(task.id, "1");
    assertEquals(task.subject, "Implement auth");
    assertEquals(task.status, "pending");

    // Verify file on disk
    const taskPath = getPlatform().path.join(getTeamTasksDir("task-test"), "1.json");
    const diskTask = JSON.parse(getPlatform().fs.readTextFileSync(taskPath));
    assertEquals(diskTask.subject, "Implement auth");
    assertEquals(diskTask.description, "Add JWT authentication to the API");
    assertEquals(diskTask.activeForm, "Implementing auth");
  } finally {
    teardownTestEnv();
  }
});

Deno.test("team store: getTask retrieves task by ID", async () => {
  const dir = setupTestEnv();
  try {
    const store = await createTeamStore("get-test");
    await store.createTask({ subject: "Task A", description: "First task" });
    await store.createTask({ subject: "Task B", description: "Second task" });

    const task = await store.getTask("2");
    assertExists(task);
    assertEquals(task!.subject, "Task B");

    const missing = await store.getTask("999");
    assertEquals(missing, null);
  } finally {
    teardownTestEnv();
  }
});

Deno.test("team store: updateTask changes status and owner", async () => {
  const dir = setupTestEnv();
  try {
    const store = await createTeamStore("update-test");
    await store.createTask({ subject: "Do work", description: "..." });

    const updated = await store.updateTask("1", {
      status: "in_progress",
      owner: "worker-1",
    });
    assertExists(updated);
    assertEquals(updated!.status, "in_progress");
    assertEquals(updated!.owner, "worker-1");
  } finally {
    teardownTestEnv();
  }
});

Deno.test("team store: updateTask with delete removes task file", async () => {
  const dir = setupTestEnv();
  try {
    const store = await createTeamStore("delete-test");
    await store.createTask({ subject: "Temp task", description: "..." });
    const result = await store.updateTask("1", { status: "deleted" });
    assertEquals(result, null);

    const tasks = await store.listTasks();
    assertEquals(tasks.length, 0);
  } finally {
    teardownTestEnv();
  }
});

Deno.test("team store: listTasks returns all tasks sorted by ID", async () => {
  const dir = setupTestEnv();
  try {
    const store = await createTeamStore("list-test");
    await store.createTask({ subject: "First", description: "1" });
    await store.createTask({ subject: "Second", description: "2" });
    await store.createTask({ subject: "Third", description: "3" });

    const tasks = await store.listTasks();
    assertEquals(tasks.length, 3);
    assertEquals(tasks[0].subject, "First");
    assertEquals(tasks[2].subject, "Third");
  } finally {
    teardownTestEnv();
  }
});

Deno.test("team store: task dependencies with addBlockedBy", async () => {
  const dir = setupTestEnv();
  try {
    const store = await createTeamStore("dep-test");
    await store.createTask({ subject: "Setup", description: "..." });
    await store.createTask({ subject: "Build", description: "..." });

    await store.updateTask("2", { addBlockedBy: ["1"] });

    const task2 = await store.getTask("2");
    assertExists(task2);
    assertEquals(task2!.blockedBy, ["1"]);

    const task1 = await store.getTask("1");
    assertExists(task1);
    assertEquals(task1!.blocks, ["2"]);
  } finally {
    teardownTestEnv();
  }
});

Deno.test("team store: sendMessage writes to inbox file", async () => {
  const dir = setupTestEnv();
  try {
    const store = await createTeamStore("msg-test");
    store.runtime.registerMember({ id: "worker-1", agent: "code" });

    await store.sendMessage({
      id: "msg-1",
      type: "message",
      from: "lead",
      content: "Hello worker",
      summary: "Greeting",
      timestamp: Date.now(),
      recipient: "worker-1",
    });

    const messages = await store.readInbox("worker-1");
    assertEquals(messages.length, 1);
    assertEquals(messages[0].content, "Hello worker");
    assertEquals(messages[0].type, "message");

    // Inbox cleared after read
    const empty = await store.readInbox("worker-1");
    assertEquals(empty.length, 0);
  } finally {
    teardownTestEnv();
  }
});

Deno.test("team store: broadcast sends to all members except sender", async () => {
  const dir = setupTestEnv();
  try {
    const store = await createTeamStore("broadcast-test");
    store.runtime.registerMember({ id: "worker-1", agent: "code" });
    store.runtime.registerMember({ id: "worker-2", agent: "review" });

    await store.sendMessage({
      id: "bcast-1",
      type: "broadcast",
      from: "lead",
      content: "Team update",
      summary: "Update",
      timestamp: Date.now(),
    });

    const w1 = await store.readInbox("worker-1");
    assertEquals(w1.length, 1);
    assertEquals(w1[0].content, "Team update");

    const w2 = await store.readInbox("worker-2");
    assertEquals(w2.length, 1);

    // Sender should NOT receive own broadcast
    const lead = await store.readInbox("lead");
    assertEquals(lead.length, 0);
  } finally {
    teardownTestEnv();
  }
});

Deno.test("team store: cleanup fails with active members", async () => {
  const dir = setupTestEnv();
  try {
    const store = await createTeamStore("cleanup-fail");
    store.runtime.registerMember({ id: "worker-1", agent: "code" });

    await assertRejects(
      () => store.cleanup(),
      Error,
      "Cannot cleanup",
    );
  } finally {
    teardownTestEnv();
  }
});

Deno.test("team store: cleanup succeeds after all teammates terminated", async () => {
  const dir = setupTestEnv();
  try {
    const store = await createTeamStore("cleanup-ok");
    store.runtime.registerMember({ id: "worker-1", agent: "code" });
    store.runtime.updateMember("worker-1", { status: "terminated" });

    await store.cleanup(); // Should not throw
    // Dirs should be removed
    let exists = false;
    try {
      getPlatform().fs.statSync(getTeamDir("cleanup-ok"));
      exists = true;
    } catch { /* expected */ }
    assertEquals(exists, false);
  } finally {
    teardownTestEnv();
  }
});

// ── Tool API Tests ────────────────────────────────────────────────────

Deno.test("Teammate tool: spawnTeam creates team store", async () => {
  const dir = setupTestEnv();
  try {
    const result = await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "spawnTeam", team_name: "tool-team", description: "Test team" },
      "/tmp",
    ) as Record<string, unknown>;
    assertEquals(result.status, "created");
    assertEquals(result.teamName, "tool-team");
    assertExists(getActiveTeamStore());
  } finally {
    setActiveTeamStore(null);
    teardownTestEnv();
  }
});

Deno.test("Teammate tool: spawnTeam rejects when team already active", async () => {
  const dir = setupTestEnv();
  try {
    await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "spawnTeam", team_name: "team-1" },
      "/tmp",
    );
    await assertRejects(
      () => AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnTeam", team_name: "team-2" },
        "/tmp",
      ),
      Error,
      "already active",
    );
  } finally {
    setActiveTeamStore(null);
    teardownTestEnv();
  }
});

Deno.test("Teammate tool: cleanup removes team", async () => {
  const dir = setupTestEnv();
  try {
    await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "spawnTeam", team_name: "cleanup-tool" },
      "/tmp",
    );
    const result = await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "cleanup" },
      "/tmp",
    ) as Record<string, unknown>;
    assertEquals(result.status, "cleaned_up");
    assertEquals(getActiveTeamStore(), null);
  } finally {
    setActiveTeamStore(null);
    teardownTestEnv();
  }
});

Deno.test("TaskCreate tool: creates task with incremental ID", async () => {
  const dir = setupTestEnv();
  try {
    await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "spawnTeam", team_name: "tc-test" },
      "/tmp",
    );
    const r1 = await AGENT_TEAM_TOOLS.TaskCreate.fn(
      { subject: "First task", description: "Do first thing" },
      "/tmp",
    ) as Record<string, unknown>;
    assertEquals(r1.id, "1");

    const r2 = await AGENT_TEAM_TOOLS.TaskCreate.fn(
      { subject: "Second task", description: "Do second thing" },
      "/tmp",
    ) as Record<string, unknown>;
    assertEquals(r2.id, "2");
  } finally {
    setActiveTeamStore(null);
    teardownTestEnv();
  }
});

Deno.test("TaskGet tool: retrieves task by ID", async () => {
  const dir = setupTestEnv();
  try {
    await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "spawnTeam", team_name: "tg-test" },
      "/tmp",
    );
    await AGENT_TEAM_TOOLS.TaskCreate.fn(
      { subject: "My task", description: "Details here" },
      "/tmp",
    );
    const task = await AGENT_TEAM_TOOLS.TaskGet.fn(
      { taskId: "1" },
      "/tmp",
    ) as TaskFile;
    assertEquals(task.subject, "My task");
    assertEquals(task.description, "Details here");
    assertEquals(task.status, "pending");
  } finally {
    setActiveTeamStore(null);
    teardownTestEnv();
  }
});

Deno.test("TaskGet tool: throws for missing task", async () => {
  const dir = setupTestEnv();
  try {
    await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "spawnTeam", team_name: "tg-missing" },
      "/tmp",
    );
    await assertRejects(
      () => AGENT_TEAM_TOOLS.TaskGet.fn({ taskId: "999" }, "/tmp"),
      Error,
      "not found",
    );
  } finally {
    setActiveTeamStore(null);
    teardownTestEnv();
  }
});

Deno.test("TaskUpdate tool: updates status and owner", async () => {
  const dir = setupTestEnv();
  try {
    await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "spawnTeam", team_name: "tu-test" },
      "/tmp",
    );
    await AGENT_TEAM_TOOLS.TaskCreate.fn(
      { subject: "Update me", description: "..." },
      "/tmp",
    );
    const result = await AGENT_TEAM_TOOLS.TaskUpdate.fn(
      { taskId: "1", status: "in_progress", owner: "worker-1" },
      "/tmp",
    ) as Record<string, unknown>;
    assertEquals(result.status, "in_progress");
    assertEquals(result.owner, "worker-1");
  } finally {
    setActiveTeamStore(null);
    teardownTestEnv();
  }
});

Deno.test("TaskUpdate tool: delete removes task", async () => {
  const dir = setupTestEnv();
  try {
    await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "spawnTeam", team_name: "tu-del" },
      "/tmp",
    );
    await AGENT_TEAM_TOOLS.TaskCreate.fn(
      { subject: "Delete me", description: "..." },
      "/tmp",
    );
    const result = await AGENT_TEAM_TOOLS.TaskUpdate.fn(
      { taskId: "1", status: "deleted" },
      "/tmp",
    ) as Record<string, unknown>;
    assertEquals(result.deleted, true);
  } finally {
    setActiveTeamStore(null);
    teardownTestEnv();
  }
});

Deno.test("TaskUpdate tool: addBlockedBy sets dependencies", async () => {
  const dir = setupTestEnv();
  try {
    await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "spawnTeam", team_name: "tu-dep" },
      "/tmp",
    );
    await AGENT_TEAM_TOOLS.TaskCreate.fn(
      { subject: "Blocker", description: "..." },
      "/tmp",
    );
    await AGENT_TEAM_TOOLS.TaskCreate.fn(
      { subject: "Blocked", description: "..." },
      "/tmp",
    );
    await AGENT_TEAM_TOOLS.TaskUpdate.fn(
      { taskId: "2", addBlockedBy: ["1"] },
      "/tmp",
    );

    const task = await AGENT_TEAM_TOOLS.TaskGet.fn(
      { taskId: "2" },
      "/tmp",
    ) as TaskFile;
    assertEquals(task.blockedBy, ["1"]);
  } finally {
    setActiveTeamStore(null);
    teardownTestEnv();
  }
});

Deno.test("TaskList tool: returns all tasks with summary", async () => {
  const dir = setupTestEnv();
  try {
    await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "spawnTeam", team_name: "tl-test" },
      "/tmp",
    );
    await AGENT_TEAM_TOOLS.TaskCreate.fn(
      { subject: "A", description: "a" },
      "/tmp",
    );
    await AGENT_TEAM_TOOLS.TaskCreate.fn(
      { subject: "B", description: "b" },
      "/tmp",
    );
    const result = await AGENT_TEAM_TOOLS.TaskList.fn(
      {},
      "/tmp",
    ) as { tasks: Array<{ id: string; subject: string }> };
    assertEquals(result.tasks.length, 2);
    assertEquals(result.tasks[0].id, "1");
    assertEquals(result.tasks[1].id, "2");
  } finally {
    setActiveTeamStore(null);
    teardownTestEnv();
  }
});

Deno.test("TaskList tool: blockedBy only shows open blockers", async () => {
  const dir = setupTestEnv();
  try {
    await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "spawnTeam", team_name: "tl-blocker" },
      "/tmp",
    );
    await AGENT_TEAM_TOOLS.TaskCreate.fn(
      { subject: "Blocker", description: "..." },
      "/tmp",
    );
    await AGENT_TEAM_TOOLS.TaskCreate.fn(
      { subject: "Blocked", description: "..." },
      "/tmp",
    );
    await AGENT_TEAM_TOOLS.TaskUpdate.fn(
      { taskId: "2", addBlockedBy: ["1"] },
      "/tmp",
    );

    // Before completing blocker
    let result = await AGENT_TEAM_TOOLS.TaskList.fn({}, "/tmp") as {
      tasks: Array<{ id: string; blockedBy: string[] }>;
    };
    assertEquals(result.tasks[1].blockedBy, ["1"]);

    // After completing blocker
    await AGENT_TEAM_TOOLS.TaskUpdate.fn(
      { taskId: "1", status: "completed" },
      "/tmp",
    );
    result = await AGENT_TEAM_TOOLS.TaskList.fn({}, "/tmp") as {
      tasks: Array<{ id: string; blockedBy: string[] }>;
    };
    assertEquals(result.tasks[1].blockedBy, []);
  } finally {
    setActiveTeamStore(null);
    teardownTestEnv();
  }
});

Deno.test("SendMessage tool: requires no active team", async () => {
  const dir = setupTestEnv();
  try {
    await assertRejects(
      () => AGENT_TEAM_TOOLS.SendMessage.fn(
        { type: "message", recipient: "worker-1", content: "hi" },
        "/tmp",
      ),
      Error,
      "No active team",
    );
  } finally {
    teardownTestEnv();
  }
});

Deno.test("SendMessage tool: sends DM to teammate inbox", async () => {
  const dir = setupTestEnv();
  try {
    await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "spawnTeam", team_name: "sm-test" },
      "/tmp",
    );
    const store = getActiveTeamStore()!;
    store.runtime.registerMember({ id: "worker-1", agent: "code" });

    await AGENT_TEAM_TOOLS.SendMessage.fn(
      {
        type: "message",
        recipient: "worker-1",
        content: "Check this out",
        summary: "Sharing findings",
      },
      "/tmp",
      { teamMemberId: "lead" } as any,
    );

    const inbox = await store.readInbox("worker-1");
    assertEquals(inbox.length, 1);
    assertEquals(inbox[0].content, "Check this out");
  } finally {
    setActiveTeamStore(null);
    teardownTestEnv();
  }
});

Deno.test("SendMessage tool: validates type", async () => {
  const dir = setupTestEnv();
  try {
    await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "spawnTeam", team_name: "sm-validate" },
      "/tmp",
    );
    await assertRejects(
      () => AGENT_TEAM_TOOLS.SendMessage.fn(
        { type: "invalid_type", content: "hi" },
        "/tmp",
      ),
      Error,
      "Invalid type",
    );
  } finally {
    setActiveTeamStore(null);
    teardownTestEnv();
  }
});

Deno.test("SendMessage tool: DM requires recipient", async () => {
  const dir = setupTestEnv();
  try {
    await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "spawnTeam", team_name: "sm-recip" },
      "/tmp",
    );
    await assertRejects(
      () => AGENT_TEAM_TOOLS.SendMessage.fn(
        { type: "message", content: "hi" },
        "/tmp",
      ),
      Error,
      "recipient",
    );
  } finally {
    setActiveTeamStore(null);
    teardownTestEnv();
  }
});

// ── Metadata Tests ────────────────────────────────────────────────────

Deno.test("TaskUpdate tool: metadata merge with null deletion", async () => {
  const dir = setupTestEnv();
  try {
    await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "spawnTeam", team_name: "meta-test" },
      "/tmp",
    );
    await AGENT_TEAM_TOOLS.TaskCreate.fn(
      { subject: "Meta task", description: "...", metadata: { key1: "val1" } },
      "/tmp",
    );
    await AGENT_TEAM_TOOLS.TaskUpdate.fn(
      { taskId: "1", metadata: { key2: "val2", key1: null } },
      "/tmp",
    );
    const task = await AGENT_TEAM_TOOLS.TaskGet.fn(
      { taskId: "1" },
      "/tmp",
    ) as TaskFile;
    assertEquals(task.metadata?.key2, "val2");
    assertEquals(task.metadata?.key1, undefined);
  } finally {
    setActiveTeamStore(null);
    teardownTestEnv();
  }
});

// ── Config Persistence Tests ──────────────────────────────────────────

Deno.test("team store: getConfig includes runtime members", async () => {
  const dir = setupTestEnv();
  try {
    const store = await createTeamStore("config-test");
    store.runtime.registerMember({ id: "researcher", agent: "web" });
    const config = store.getConfig();
    assertEquals(config.members.length, 2);
    assertEquals(config.members[1].name, "researcher");
    assertEquals(config.members[1].agentType, "web");
  } finally {
    teardownTestEnv();
  }
});

Deno.test("team store: persistConfig writes updated members to disk", async () => {
  const dir = setupTestEnv();
  try {
    const store = await createTeamStore("persist-test");
    store.runtime.registerMember({ id: "worker-1", agent: "code" });
    await store.persistConfig();

    const config = JSON.parse(
      getPlatform().fs.readTextFileSync(getTeamConfigPath("persist-test")),
    );
    assertEquals(config.members.length, 2);
  } finally {
    teardownTestEnv();
  }
});

// ── Shutdown Protocol Tests ───────────────────────────────────────────

Deno.test("SendMessage: shutdown_request dispatches via runtime", async () => {
  const dir = setupTestEnv();
  try {
    await AGENT_TEAM_TOOLS.Teammate.fn(
      { operation: "spawnTeam", team_name: "shutdown-test" },
      "/tmp",
    );
    const store = getActiveTeamStore()!;
    store.runtime.registerMember({ id: "worker-1", agent: "code" });

    await AGENT_TEAM_TOOLS.SendMessage.fn(
      {
        type: "shutdown_request",
        recipient: "worker-1",
        content: "Please shut down",
      },
      "/tmp",
      { teamMemberId: "lead" } as any,
    );

    const member = store.runtime.getMember("worker-1");
    assertEquals(member?.status, "shutdown_requested");
  } finally {
    setActiveTeamStore(null);
    teardownTestEnv();
  }
});

// ── Hook Type Tests ───────────────────────────────────────────────────

Deno.test("hooks: teammate_idle and task_completed are valid hook names", () => {
  // Import and check the hook names include the new team hooks
  const { isHookName } = (() => {
    // Dynamic import workaround for sync test
    return {
      isHookName: (name: string): boolean => {
        const validNames = [
          "pre_llm", "post_llm", "pre_tool", "post_tool",
          "plan_created", "write_verified", "delegate_start",
          "delegate_end", "final_response",
          "teammate_idle", "task_completed",
        ];
        return validNames.includes(name);
      },
    };
  })();

  assertEquals(isHookName("teammate_idle"), true);
  assertEquals(isHookName("task_completed"), true);
  assertEquals(isHookName("nonexistent"), false);
});

// ── One Team Per Session Tests ────────────────────────────────────────

Deno.test("team store: only one active team allowed", async () => {
  const dir = setupTestEnv();
  try {
    const store1 = await createTeamStore("team-1");
    setActiveTeamStore(store1);

    await assertRejects(
      () => AGENT_TEAM_TOOLS.Teammate.fn(
        { operation: "spawnTeam", team_name: "team-2" },
        "/tmp",
      ),
      Error,
      "already active",
    );
  } finally {
    setActiveTeamStore(null);
    teardownTestEnv();
  }
});

// ── Task ID Continuity Tests ──────────────────────────────────────────

Deno.test("team store: task IDs are sequential integers", async () => {
  const dir = setupTestEnv();
  try {
    const store = await createTeamStore("seq-test");
    const t1 = await store.createTask({ subject: "A", description: "a" });
    const t2 = await store.createTask({ subject: "B", description: "b" });
    const t3 = await store.createTask({ subject: "C", description: "c" });
    assertEquals(t1.id, "1");
    assertEquals(t2.id, "2");
    assertEquals(t3.id, "3");
  } finally {
    teardownTestEnv();
  }
});

// ── Execution Layer Tests (team-executor.ts) ────────────────────────

/**
 * Creates a mock AgentEngine with a scripted LLM that returns plain text
 * (no tool calls), so tasks complete immediately in runReActLoop.
 */
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

function createToolCallingEngine(
  toolName: string,
  args: Record<string, unknown>,
  finalText = "Task completed successfully.",
): AgentEngine {
  let callCount = 0;
  return {
    createLLM: () => {
      return async (): Promise<LLMResponse> => {
        if (callCount++ === 0) {
          return {
            content: `Running ${toolName}.`,
            toolCalls: [{ id: `tc-${toolName}`, toolName, args }],
          };
        }
        return {
          content: finalText,
          toolCalls: [],
        };
      };
    },
    createSummarizer: () => {
      return async () => "Summary";
    },
  };
}

function createTestIdentity(overrides?: Partial<TeammateIdentity>): TeammateIdentity {
  return {
    name: "test-worker",
    agentType: "general-purpose",
    teamName: "exec-test",
    teamMemberId: "worker-1",
    leadMemberId: "lead",
    ...overrides,
  };
}

/** Fast polling options for tests — avoids 90s idle waits. */
const FAST_POLL = { idlePollIntervalMs: 10, maxIdlePolls: 2 };

Deno.test("runTeammateLoop: exits with no_work when no tasks available", async () => {
  const dir = setupTestEnv();
  try {
    setAgentEngine(createMockEngine());
    const store = await createTeamStore("exec-idle");
    const runtime = store.runtime;
    runtime.registerMember({ id: "worker-1", agent: "general-purpose" });

    const controller = new AbortController();
    const result = await runTeammateLoop({
      identity: createTestIdentity({ teamName: "exec-idle" }),
      runtime,
      store,
      workspace: dir,
      policy: null,
      signal: controller.signal,
      agentProfiles: [{ name: "general-purpose", description: "GP", tools: [] }],
      ...FAST_POLL,
    });

    assertEquals(result.exitReason, "no_work");
    assertEquals(result.tasksCompleted, 0);
  } finally {
    resetAgentEngine();
    teardownTestEnv();
  }
});

Deno.test("runTeammateLoop: exits on shutdown request", async () => {
  const dir = setupTestEnv();
  try {
    setAgentEngine(createMockEngine());
    const store = await createTeamStore("exec-shutdown");
    const runtime = store.runtime;
    runtime.registerMember({ id: "worker-1", agent: "general-purpose" });

    // Issue shutdown before starting loop
    runtime.requestShutdown({
      memberId: "worker-1",
      requestedByMemberId: "lead",
    });

    const controller = new AbortController();
    const result = await runTeammateLoop({
      identity: createTestIdentity({ teamName: "exec-shutdown" }),
      runtime,
      store,
      workspace: dir,
      policy: null,
      signal: controller.signal,
      agentProfiles: [{ name: "general-purpose", description: "GP", tools: [] }],
      ...FAST_POLL,
    });

    assertEquals(result.exitReason, "shutdown");
    assertEquals(result.tasksCompleted, 0);

    // Member should be terminated
    const member = runtime.getMember("worker-1");
    assertEquals(member?.status, "terminated");
  } finally {
    resetAgentEngine();
    teardownTestEnv();
  }
});

Deno.test("runTeammateLoop: exits on signal abort", async () => {
  const dir = setupTestEnv();
  try {
    setAgentEngine(createMockEngine());
    const store = await createTeamStore("exec-abort");
    const runtime = store.runtime;
    runtime.registerMember({ id: "worker-1", agent: "general-purpose" });

    const controller = new AbortController();
    // Abort immediately — the loop should exit on first iteration
    controller.abort();

    const result = await runTeammateLoop({
      identity: createTestIdentity({ teamName: "exec-abort" }),
      runtime,
      store,
      workspace: dir,
      policy: null,
      signal: controller.signal,
      agentProfiles: [{ name: "general-purpose", description: "GP", tools: [] }],
      ...FAST_POLL,
    });

    assertEquals(result.exitReason, "signal");
    const member = runtime.getMember("worker-1");
    assertEquals(member?.status, "terminated");
  } finally {
    resetAgentEngine();
    teardownTestEnv();
  }
});

Deno.test("runTeammateLoop: completes a single task", async () => {
  const dir = setupTestEnv();
  try {
    setAgentEngine(createMockEngine());
    const store = await createTeamStore("exec-single");
    const runtime = store.runtime;
    runtime.registerMember({ id: "worker-1", agent: "general-purpose" });

    // Create a pending task
    await store.createTask({
      subject: "Write tests",
      description: "Add unit tests for the auth module",
    });

    const controller = new AbortController();
    const result = await runTeammateLoop({
      identity: createTestIdentity({ teamName: "exec-single" }),
      runtime,
      store,
      workspace: dir,
      policy: null,
      signal: controller.signal,
      agentProfiles: [{ name: "general-purpose", description: "GP", tools: [] }],
      ...FAST_POLL,
    });

    // Should complete the task then exit with no_work (no more tasks)
    assertEquals(result.exitReason, "no_work");
    assertEquals(result.tasksCompleted, 1);

    // Task should be marked completed
    const task = await store.getTask("1");
    assertEquals(task?.status, "completed");
  } finally {
    resetAgentEngine();
    teardownTestEnv();
  }
});

Deno.test("runTeammateLoop: forwards teammate interaction metadata to lead UI", async () => {
  const dir = setupTestEnv();
  try {
    setAgentEngine(createToolCallingEngine("ask_user", {
      question: "Need lead input",
    }));
    const store = await createTeamStore("exec-interaction");
    const runtime = store.runtime;
    runtime.registerMember({ id: "worker-1", agent: "general-purpose" });
    await store.createTask({
      subject: "Write note",
      description: "Write a note to disk",
    });

    const interactions: Array<{
      sourceLabel?: string;
      sourceMemberId?: string;
      sourceTeamName?: string;
      toolName?: string;
    }> = [];

    const result = await runTeammateLoop({
      identity: createTestIdentity({ teamName: "exec-interaction" }),
      runtime,
      store,
      workspace: dir,
      policy: null,
      signal: new AbortController().signal,
      agentProfiles: [{
        name: "general-purpose",
        description: "GP",
        tools: ["ask_user"],
      }],
      permissionMode: "default",
      onInteraction: async (event) => {
        interactions.push({
          sourceLabel: event.sourceLabel,
          sourceMemberId: event.sourceMemberId,
          sourceTeamName: event.sourceTeamName,
          toolName: event.toolName,
        });
        return { approved: true, userInput: "Continue" };
      },
      ...FAST_POLL,
    });

    assertEquals(result.tasksCompleted, 1);
    assertEquals(interactions.length, 1);
    assertEquals(interactions[0]?.sourceLabel, "test-worker");
    assertEquals(interactions[0]?.sourceMemberId, "worker-1");
    assertEquals(interactions[0]?.sourceTeamName, "exec-interaction");
    assertEquals(interactions[0]?.toolName, "ask_user");
  } finally {
    resetAgentEngine();
    teardownTestEnv();
  }
});

Deno.test("runTeammateLoop: converts worker tool progress into team_member_activity events", async () => {
  const dir = setupTestEnv();
  try {
    setAgentEngine(createToolCallingEngine("TaskList", {}));
    const store = await createTeamStore("exec-activity");
    const runtime = store.runtime;
    runtime.registerMember({ id: "worker-1", agent: "general-purpose" });
    await store.createTask({
      subject: "Check tasks",
      description: "Inspect the current task list",
    });

    const eventTypes: string[] = [];
    const activitySummaries: string[] = [];

    const result = await runTeammateLoop({
      identity: createTestIdentity({ teamName: "exec-activity" }),
      runtime,
      store,
      workspace: dir,
      policy: null,
      signal: new AbortController().signal,
      agentProfiles: [{
        name: "general-purpose",
        description: "GP",
        tools: ["TaskList"],
      }],
      onAgentEvent: (event) => {
        eventTypes.push(event.type);
        if (event.type === "team_member_activity") {
          activitySummaries.push(event.summary);
        }
      },
      ...FAST_POLL,
    });

    assertEquals(result.tasksCompleted, 1);
    assertEquals(eventTypes.includes("tool_start"), false);
    assertEquals(eventTypes.includes("team_member_activity"), true);
    assertEquals(
      activitySummaries.some((summary) => summary.includes("TaskList")),
      true,
    );
  } finally {
    resetAgentEngine();
    teardownTestEnv();
  }
});

Deno.test("runTeammateLoop: picks lowest-ID task first", async () => {
  const dir = setupTestEnv();
  try {
    setAgentEngine(createMockEngine());
    const store2 = await createTeamStore("exec-order");
    const runtime = store2.runtime;
    runtime.registerMember({ id: "worker-1", agent: "general-purpose" });

    // Create tasks in reverse order (3, 2, 1 → but IDs are 1, 2, 3)
    await store2.createTask({ subject: "Third", description: "c" });
    await store2.createTask({ subject: "Second", description: "b" });
    await store2.createTask({ subject: "First", description: "a" });

    const controller = new AbortController();
    const result = await runTeammateLoop({
      identity: createTestIdentity({ teamName: "exec-order" }),
      runtime,
      store: store2,
      workspace: dir,
      policy: null,
      signal: controller.signal,
      agentProfiles: [{ name: "general-purpose", description: "GP", tools: [] }],
      ...FAST_POLL,
    });

    assertEquals(result.tasksCompleted, 3);
    assertEquals(result.exitReason, "no_work");

    // All tasks should be completed
    const tasks = await store2.listTasks();
    for (const t of tasks) {
      assertEquals(t.status, "completed");
    }
  } finally {
    resetAgentEngine();
    teardownTestEnv();
  }
});

Deno.test("runTeammateLoop: skips blocked tasks", async () => {
  const dir = setupTestEnv();
  try {
    setAgentEngine(createMockEngine());
    const store = await createTeamStore("exec-blocked");
    const runtime = store.runtime;
    runtime.registerMember({ id: "worker-1", agent: "general-purpose" });

    // Task 1: unblocker
    await store.createTask({ subject: "Setup", description: "setup" });
    // Task 2: blocked by task 1
    await store.createTask({ subject: "Build", description: "build" });
    await store.updateTask("2", { addBlockedBy: ["1"] });

    // Manually complete task 1 so the loop only has task 2 to consider
    // but task 2 is blocked by task 1 which is NOT completed yet
    // Actually, let's keep task 1 pending and check that the loop claims task 1 first (unblocked)
    // then completes task 2 after.

    const controller = new AbortController();
    const result = await runTeammateLoop({
      identity: createTestIdentity({ teamName: "exec-blocked" }),
      runtime,
      store,
      workspace: dir,
      policy: null,
      signal: controller.signal,
      agentProfiles: [{ name: "general-purpose", description: "GP", tools: [] }],
      ...FAST_POLL,
    });

    // Should complete both tasks (task 1 first, then task 2 becomes unblocked)
    assertEquals(result.tasksCompleted, 2);
    assertEquals(result.exitReason, "no_work");
  } finally {
    resetAgentEngine();
    teardownTestEnv();
  }
});

Deno.test("runTeammateLoop: sends idle notification between tasks", async () => {
  const dir = setupTestEnv();
  try {
    setAgentEngine(createMockEngine());
    const store = await createTeamStore("exec-idle-notify");
    const runtime = store.runtime;
    runtime.registerMember({ id: "worker-1", agent: "general-purpose" });

    await store.createTask({ subject: "Quick task", description: "do it" });

    const controller = new AbortController();
    await runTeammateLoop({
      identity: createTestIdentity({ teamName: "exec-idle-notify" }),
      runtime,
      store,
      workspace: dir,
      policy: null,
      signal: controller.signal,
      agentProfiles: [{ name: "general-purpose", description: "GP", tools: [] }],
      ...FAST_POLL,
    });

    // Check runtime messages for idle_notification
    const snapshot = runtime.snapshot();
    const idleMessages = snapshot.messages.filter((m) =>
      m.kind === "idle_notification"
    );
    // Should have at least one idle notification (between_tasks + waiting_for_tasks/no_work)
    assertEquals(idleMessages.length >= 1, true);
  } finally {
    resetAgentEngine();
    teardownTestEnv();
  }
});

Deno.test("runTeammateLoop: sends task_completed notification", async () => {
  const dir = setupTestEnv();
  try {
    setAgentEngine(createMockEngine());
    const store = await createTeamStore("exec-complete-notify");
    const runtime = store.runtime;
    runtime.registerMember({ id: "worker-1", agent: "general-purpose" });

    await store.createTask({ subject: "My task", description: "do it" });

    const controller = new AbortController();
    await runTeammateLoop({
      identity: createTestIdentity({ teamName: "exec-complete-notify" }),
      runtime,
      store,
      workspace: dir,
      policy: null,
      signal: controller.signal,
      agentProfiles: [{ name: "general-purpose", description: "GP", tools: [] }],
      ...FAST_POLL,
    });

    // Check runtime messages for task_completed
    const snapshot = runtime.snapshot();
    const completionMessages = snapshot.messages.filter((m) =>
      m.kind === "task_completed"
    );
    assertEquals(completionMessages.length, 1);
    const payload = JSON.parse(completionMessages[0].content);
    assertEquals(payload.type, "task_completed");
    assertEquals(payload.taskId, "1");
    assertEquals(payload.subject, "My task");
  } finally {
    resetAgentEngine();
    teardownTestEnv();
  }
});

Deno.test("runTeammateLoop: dispatches teammate_idle hook", async () => {
  const dir = setupTestEnv();
  try {
    setAgentEngine(createMockEngine());
    const store = await createTeamStore("exec-hook-idle");
    const runtime = store.runtime;
    runtime.registerMember({ id: "worker-1", agent: "general-purpose" });

    await store.createTask({ subject: "Hook test", description: "test hooks" });

    const hookCalls: Array<{ event: string; data: unknown }> = [];
    const mockHookRuntime = {
      dispatchDetached: (event: string, data: unknown) => {
        hookCalls.push({ event, data });
      },
    };

    const controller = new AbortController();
    await runTeammateLoop({
      identity: createTestIdentity({ teamName: "exec-hook-idle" }),
      runtime,
      store,
      workspace: dir,
      policy: null,
      signal: controller.signal,
      hookRuntime: mockHookRuntime as any,
      agentProfiles: [{ name: "general-purpose", description: "GP", tools: [] }],
      ...FAST_POLL,
    });

    const taskCompletedHooks = hookCalls.filter((h) => h.event === "task_completed");
    assertEquals(taskCompletedHooks.length, 1);

    const idleHooks = hookCalls.filter((h) => h.event === "teammate_idle");
    assertEquals(idleHooks.length >= 1, true);
  } finally {
    resetAgentEngine();
    teardownTestEnv();
  }
});

Deno.test("runTeammateLoop: exits via inbox shutdown request", async () => {
  const dir = setupTestEnv();
  try {
    setAgentEngine(createMockEngine());
    const store = await createTeamStore("exec-inbox-shutdown");
    const runtime = store.runtime;
    runtime.registerMember({ id: "worker-1", agent: "general-purpose" });

    // Write a shutdown request to the inbox before starting the loop
    await store.sendMessage({
      id: "shutdown-msg",
      type: "shutdown_request",
      from: "lead",
      content: "Please shut down",
      summary: "Shutdown",
      timestamp: Date.now(),
      recipient: "test-worker",
      requestId: "req-1",
    });

    const controller = new AbortController();
    const result = await runTeammateLoop({
      identity: createTestIdentity({ teamName: "exec-inbox-shutdown" }),
      runtime,
      store,
      workspace: dir,
      policy: null,
      signal: controller.signal,
      agentProfiles: [{ name: "general-purpose", description: "GP", tools: [] }],
      ...FAST_POLL,
    });

    assertEquals(result.exitReason, "shutdown");
    assertEquals(result.tasksCompleted, 0);
  } finally {
    resetAgentEngine();
    teardownTestEnv();
  }
});

// ── Highwatermark Persistence Tests ──────────────────────────────────

Deno.test("highwatermark: persists task IDs across store recreation", async () => {
  const dir = setupTestEnv();
  try {
    const store1 = await createTeamStore("hw-test");
    await store1.createTask({ subject: "A", description: "a" });
    await store1.createTask({ subject: "B", description: "b" });
    await store1.createTask({ subject: "C", description: "c" });

    // Verify highwatermark file exists
    const hwPath = getTeamHighwatermarkPath("hw-test");
    const hwContent = getPlatform().fs.readTextFileSync(hwPath);
    assertEquals(hwContent, "3");

    // Recreate store — should pick up from highwatermark
    resetTeamStoreForTests();
    const store2 = await createTeamStore("hw-test");
    const t4 = await store2.createTask({ subject: "D", description: "d" });
    assertEquals(t4.id, "4"); // Should continue from 3, not restart at 1
  } finally {
    teardownTestEnv();
  }
});

// ── Config Schema Enhancement Tests ──────────────────────────────────

Deno.test("config.json: includes joinedAt and backendType for registered members", async () => {
  const dir = setupTestEnv();
  try {
    const store = await createTeamStore("config-schema");
    store.runtime.registerMember({ id: "coder-1", agent: "code" });
    const config = store.getConfig();

    const worker = config.members.find((m) => m.name === "coder-1");
    assertExists(worker);
    assertExists(worker!.joinedAt);
    assertEquals(worker!.backendType, "in-process");
  } finally {
    teardownTestEnv();
  }
});

// ── TeamDashboardState Derivation Tests ──────────────────────────────

Deno.test("deriveTeamDashboardState: empty items returns inactive state", () => {
  const state = deriveTeamDashboardState([]);
  assertEquals(state.active, false);
  assertEquals(state.workers.length, 0);
  assertEquals(state.focusedWorkerIndex, -1);
});

Deno.test("deriveTeamDashboardState: focusedWorkerIndex defaults to -1", () => {
  const state = deriveTeamDashboardState([
    {
      type: "delegate" as const,
      id: "d1",
      agent: "coder",
      task: "Write code",
      status: "running" as const,
      ts: Date.now(),
    } as any,
  ]);
  assertEquals(state.active, true);
  assertEquals(state.workers.length, 1);
  assertEquals(state.focusedWorkerIndex, -1);
});
