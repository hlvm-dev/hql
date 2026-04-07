/**
 * Integration smoke tests for the team-agent foundation.
 *
 * Tests: memory isolation, token budget, batch failure notification,
 * delegation heuristics (fan-out + small task), and dashboard state accumulation.
 */
import { assert, assertEquals } from "jsr:@std/assert";
import { CHILD_TOOL_DENYLIST } from "../../../src/hlvm/agent/delegation.ts";
import {
  createDelegateTokenBudget,
  recordBudgetUsage,
} from "../../../src/hlvm/agent/delegate-token-budget.ts";
import {
  createDelegateInbox,
  formatDelegateInboxUpdateMessage,
} from "../../../src/hlvm/agent/delegate-inbox.ts";
import { evaluateDelegationSignal } from "../../../src/hlvm/agent/delegation-heuristics.ts";
import { deriveTeamDashboardState } from "../../../src/hlvm/cli/repl-ink/hooks/useTeamState.ts";
import type { ConversationItem } from "../../../src/hlvm/cli/repl-ink/types.ts";

Deno.test("Team Integration", async (t) => {
  // ── Test 1: Memory Isolation ──────────────────────────────────────────
  await t.step("memory isolation - child denylist excludes memory_write and memory_edit", () => {
    assert(
      CHILD_TOOL_DENYLIST.includes("memory_write"),
      "CHILD_TOOL_DENYLIST must include memory_write",
    );
    assert(
      CHILD_TOOL_DENYLIST.includes("memory_edit"),
      "CHILD_TOOL_DENYLIST must include memory_edit",
    );
    assert(
      !CHILD_TOOL_DENYLIST.includes("memory_search"),
      "CHILD_TOOL_DENYLIST must NOT include memory_search (read-only is allowed)",
    );
  });

  // ── Test 2: Token Budget ──────────────────────────────────────────────
  await t.step("token budget - terminates gracefully when exceeded", () => {
    const budget = createDelegateTokenBudget(1000);

    // First usage: 500 tokens, total 500 < 1000 → not exceeded
    const exceededAfterFirst = recordBudgetUsage(budget, 500);
    assertEquals(exceededAfterFirst, false, "500 tokens should not exceed budget of 1000");
    assertEquals(budget.consumed, 500);
    assertEquals(budget.exceeded, false);

    // Second usage: 600 tokens, total 1100 >= 1000 → exceeded
    const exceededAfterSecond = recordBudgetUsage(budget, 600);
    assertEquals(exceededAfterSecond, true, "1100 tokens should exceed budget of 1000");
    assertEquals(budget.consumed, 1100);
    assertEquals(budget.exceeded, true);
  });

  // ── Test 3: Batch Failure Notification ────────────────────────────────
  await t.step("batch failure notification - inbox contains ATTENTION REQUIRED", () => {
    const inbox = createDelegateInbox();

    inbox.push({
      threadId: "t1",
      nickname: "alice",
      agent: "code",
      task: "refactor auth",
      success: false,
      error: "API rate limit",
      attentionRequired: true,
      attentionReason: 'Worker "alice" failed: API rate limit',
    });

    assertEquals(inbox.size(), 1, "inbox should have 1 update");

    const updates = inbox.drain();
    assertEquals(updates.length, 1, "drain should return 1 update");
    assertEquals(inbox.size(), 0, "inbox should be empty after drain");

    const message = formatDelegateInboxUpdateMessage(updates[0]);
    assert(
      message.includes("[ATTENTION REQUIRED]"),
      `formatted message must contain [ATTENTION REQUIRED], got: ${message}`,
    );
    assert(
      message.includes("API rate limit"),
      `formatted message must contain the error text, got: ${message}`,
    );
  });

  // ── Test 4: Heuristic - Multi-file Fan-out ────────────────────────────
  await t.step("heuristic - multi-file request yields fan-out", async () => {
    const signal = await evaluateDelegationSignal(
      "refactor auth.ts login.ts session.ts concurrently",
    );
    assertEquals(signal.shouldDelegate, true, "multi-file concurrent request should delegate");
    assertEquals(signal.suggestedPattern, "fan-out", "pattern should be fan-out");
  });

  // ── Test 5: Heuristic - Small Task No Delegation ─────────────────────
  await t.step("heuristic - small task does not delegate", async () => {
    const signal = await evaluateDelegationSignal("fix typo in README");
    assertEquals(signal.shouldDelegate, false, "small task should not delegate");
  });

  // ── Test 6: Dashboard State Accumulation ──────────────────────────────
  await t.step("dashboard state accumulation from delegate events", () => {
    const items: ConversationItem[] = [
      {
        type: "delegate",
        id: "d1",
        agent: "code",
        task: "implement feature A",
        status: "running",
        threadId: "thread-1",
        nickname: "alpha",
        ts: 1000,
      },
      {
        type: "delegate",
        id: "d2",
        agent: "code",
        task: "implement feature A",
        status: "success",
        threadId: "thread-1",
        nickname: "alpha",
        durationMs: 5000,
        summary: "Done",
        ts: 2000,
      },
      {
        type: "delegate",
        id: "d3",
        agent: "reviewer",
        task: "review feature B",
        status: "error",
        threadId: "thread-2",
        nickname: "beta",
        error: "timeout",
        ts: 3000,
      },
    ];
    const state = deriveTeamDashboardState(items);

    // Assertions
    assertEquals(state.active, true, "dashboard should be active with workers");
    assertEquals(state.workers.length, 2, "should have 2 unique workers (deduped by threadId)");

    // thread-1 should reflect the latest event (success → completed)
    const alphaWorker = state.workers.find((w) => w.threadId === "thread-1");
    assert(alphaWorker !== undefined, "alpha worker should exist");
    assertEquals(alphaWorker!.status, "completed", "alpha should be completed (latest event wins)");
    assertEquals(alphaWorker!.durationMs, 5000);

    // thread-2 should be errored
    const betaWorker = state.workers.find((w) => w.threadId === "thread-2");
    assert(betaWorker !== undefined, "beta worker should exist");
    assertEquals(betaWorker!.status, "errored");

    // Task counts
    assertEquals(state.taskCounts.completed, 1);
    assertEquals(state.taskCounts.errored, 1);
    assertEquals(state.taskCounts.running, 0);

    // Attention items
    assertEquals(state.attentionItems.length, 1, "should have 1 attention item for the failed worker");
    assertEquals(state.attentionItems[0].kind, "worker_failed");
    assert(state.attentionItems[0].label.includes("timeout"));

    // Dashboard derived from conversation items (no lastUpdate field — state is derived, not timestamped)
  });
});
