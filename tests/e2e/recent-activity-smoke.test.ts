/**
 * End-to-end smoke tests for the `recent_activity` tool pipeline.
 *
 * Uses a REAL Claude Opus 4.6 via Claude Code Max subscription auth.
 * No scripted LLM — the actual model decides whether to call the tool.
 *
 * What this proves that unit tests cannot:
 *   1. The real LLM reads the system prompt instruction and calls recent_activity
 *   2. sessionId flows from agent-runner → orchestrator → tool execution → tool
 *   3. Tool reads real DB data and returns it to the LLM
 *   4. The LLM synthesizes a meaningful response from the tool result
 *   5. "before_that" follow-up navigates to the correct older block
 *   6. "what did I ask last time?" uses literal question history, not activity blocks
 *
 * Requirements:
 *   - Claude Code Max subscription (run `claude login` first)
 *   - Network access to Anthropic API
 *   - Run with: deno test --allow-all tests/e2e/recent-activity-smoke.test.ts
 */

import {
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import {
  disposeAllSessions,
  runAgentQuery,
} from "../../src/hlvm/agent/agent-runner.ts";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import { setupStoreTestDb } from "../unit/_shared/store-test-db.ts";
import { _resetDbForTesting } from "../../src/hlvm/store/db.ts";
import {
  createSession,
  insertMessage,
} from "../../src/hlvm/store/conversation-store.ts";
import { resetHlvmDirCacheForTests } from "../../src/common/paths.ts";
import { getPlatform } from "../../src/platform/platform.ts";
import {
  DAY_MS,
  getLocalDateKey,
  getLocalTimeLabel,
  getTimeZone,
} from "../../src/common/chronology.ts";

// ============================================================
// Configuration
// ============================================================

const MODEL = "claude-code/claude-opus-4-6";
const TIMEOUT_MS = 120_000;
const TIME_ZONE = getTimeZone();

// ============================================================
// Test helpers
// ============================================================

const platform = getPlatform();

function seedSession(
  id: string,
  prompts: { content: string; created_at: string }[],
): void {
  createSession("Test session", id);
  for (const p of prompts) {
    insertMessage({
      session_id: id,
      role: "user",
      content: p.content,
      sender_type: "user",
      created_at: p.created_at,
    });
  }
}

/**
 * Isolate HLVM_DIR to a temp directory so history.jsonl reads are empty
 * (no real user history leaking into tests).
 * The in-memory DB from setupStoreTestDb() still works since it's set
 * via _setDbForTesting — bypasses file-path-based DB initialization.
 */
async function withIsolatedEnv(
  fn: (workspace: string) => Promise<void>,
): Promise<void> {
  const hlvmDir = await platform.fs.makeTempDir({ prefix: "hlvm-e2e-env-" });
  const workspace = await platform.fs.makeTempDir({ prefix: "hlvm-e2e-ws-" });
  const originalHlvmDir = platform.env.get("HLVM_DIR");

  platform.env.set("HLVM_DIR", hlvmDir);
  resetHlvmDirCacheForTests();

  try {
    await fn(workspace);
  } finally {
    if (originalHlvmDir) {
      platform.env.set("HLVM_DIR", originalHlvmDir);
    } else {
      platform.env.delete("HLVM_DIR");
    }
    resetHlvmDirCacheForTests();

    for (const dir of [workspace, hlvmDir]) {
      try {
        await platform.fs.remove(dir, { recursive: true });
      } catch { /* best effort */ }
    }
  }
}

function findToolStart(
  events: AgentUIEvent[],
): Extract<AgentUIEvent, { type: "tool_start" }> | undefined {
  return events.find((event): event is Extract<AgentUIEvent, { type: "tool_start" }> =>
    event.type === "tool_start" && event.name === "recent_activity"
  );
}

function findToolEnd(
  events: AgentUIEvent[],
): Extract<AgentUIEvent, { type: "tool_end" }> | undefined {
  return events.find((event): event is Extract<AgentUIEvent, { type: "tool_end" }> =>
    event.type === "tool_end" && event.name === "recent_activity"
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function findUtcTimestampForLocal(
  dateKey: string,
  hour: number,
  minute: number,
  timeZone = TIME_ZONE,
): number {
  const targetTime = `${pad(hour)}:${pad(minute)}`;
  const base = Date.parse(`${dateKey}T${targetTime}:00Z`);

  for (let deltaMinutes = -24 * 60; deltaMinutes <= 24 * 60; deltaMinutes++) {
    const ts = base - deltaMinutes * 60_000;
    if (
      getLocalDateKey(ts, timeZone) === dateKey &&
      getLocalTimeLabel(ts, timeZone) === targetTime
    ) {
      return ts;
    }
  }

  throw new Error(
    `Could not find UTC timestamp for local ${dateKey} ${targetTime} in ${timeZone}`,
  );
}

async function withRecentActivityTest(
  fn: (context: { controller: AbortController }) => Promise<void>,
): Promise<void> {
  const db = setupStoreTestDb();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    await fn({ controller });
  } finally {
    clearTimeout(timeout);
    _resetDbForTesting();
    await disposeAllSessions();
    db.close();
  }
}

// ============================================================
// Test 1: Real LLM semantically routes a natural recent-activity question
// ============================================================

Deno.test({
  name: "E2E real LLM: Claude routes a natural recent-activity question to recent_activity",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRecentActivityTest(async ({ controller }) => {
      const testSessionId = "e2e-current-session";
      const olderSessionId = "e2e-older-session";

      createSession("Current session", testSessionId);
      seedSession(olderSessionId, [
        { content: "refactor the authentication module", created_at: "2026-03-10T14:00:00Z" },
        { content: "add JWT token validation", created_at: "2026-03-10T14:05:00Z" },
        { content: "deploy to staging environment", created_at: "2026-03-11T09:00:00Z" },
      ]);

      await withIsolatedEnv(async (workspace) => {
        const events: AgentUIEvent[] = [];

        const result = await runAgentQuery({
          query: "Can you remind me what I've been working on recently?",
          model: MODEL,
          workspace,
          sessionId: testSessionId,
          permissionMode: "yolo",
          toolAllowlist: ["recent_activity"],
          disablePersistentMemory: true,
          signal: controller.signal,
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
        });

        const toolStarts = events.filter((event) =>
          event.type === "tool_start" && event.name === "recent_activity"
        );
        assertEquals(
          toolStarts.length >= 1,
          true,
          `LLM must call recent_activity. Events: ${
            events.filter((e) => e.type === "tool_start" || e.type === "tool_end")
              .map((e) => `${e.type}:${"name" in e ? e.name : "?"}`)
              .join(", ")
          }`,
        );

        const toolEnds = events.filter(
          (e): e is Extract<AgentUIEvent, { type: "tool_end" }> =>
            e.type === "tool_end" && e.name === "recent_activity",
        );
        assertEquals(toolEnds.length >= 1, true, "tool_end must fire");
        assertEquals(toolEnds[0].success, true, "tool must succeed");

        assertStringIncludes(
          toolEnds[0].content,
          "deploy to staging",
          "tool result must contain seeded prompt from other session",
        );
        assertStringIncludes(
          toolEnds[0].content,
          "other_session",
          "other session data must be labeled as other_session",
        );

        assertEquals(
          result.text.length > 10,
          true,
          `LLM must produce a meaningful response (got: "${result.text.slice(0, 100)}")`,
        );
      });
    });
  },
});

// ============================================================
// Test 2: literal question history routes to subject=questions
// ============================================================

Deno.test({
  name: "E2E real LLM: Claude routes 'what did I ask last time?' to question history",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRecentActivityTest(async ({ controller }) => {
      const sessionId = "e2e-question-last";
      seedSession(sessionId, [
        { content: "review cache metrics", created_at: "2026-03-11T09:00:00Z" },
        { content: "ship billing fix", created_at: "2026-03-11T15:00:00Z" },
      ]);

      await withIsolatedEnv(async (workspace) => {
        const events: AgentUIEvent[] = [];

        const result = await runAgentQuery({
          query: "What did I ask last time?",
          model: MODEL,
          workspace,
          sessionId,
          permissionMode: "yolo",
          toolAllowlist: ["recent_activity"],
          disablePersistentMemory: true,
          signal: controller.signal,
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
        });

        const toolStart = findToolStart(events);
        const toolEnd = findToolEnd(events);

        assertEquals(toolEnd?.success, true, "tool must succeed");
        assertStringIncludes(
          toolStart!.argsSummary,
          "last_time",
          `LLM must call with reference=last_time (got: ${toolStart?.argsSummary})`,
        );
        assertStringIncludes(
          toolStart!.argsSummary,
          "questions",
          `LLM must call with subject=questions (got: ${toolStart?.argsSummary})`,
        );
        assertStringIncludes(toolEnd!.content, "ship billing fix");
        assertEquals(
          toolEnd!.content.includes("review cache metrics"),
          false,
          "last question lookup must not fall back to an older prompt",
        );
        assertStringIncludes(
          result.text,
          "ship billing fix",
          `assistant must answer from the literal question history (got: ${result.text.slice(0, 200)})`,
        );
      });
    });
  },
});

// ============================================================
// Test 3: sessionId differentiates current_session vs other_session
// ============================================================

Deno.test({
  name: "E2E real LLM: tool distinguishes current_session from other_session via sessionId",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRecentActivityTest(async ({ controller }) => {
      const currentId = "e2e-current-2";
      const otherId = "e2e-other-2";

      seedSession(currentId, [
        { content: "fix the login page CSS bug", created_at: "2026-03-11T10:00:00Z" },
      ]);
      seedSession(otherId, [
        { content: "write integration tests for user API", created_at: "2026-03-09T15:00:00Z" },
      ]);

      await withIsolatedEnv(async (workspace) => {
        const events: AgentUIEvent[] = [];

        await runAgentQuery({
          query:
            "Summarize my two most recent activity blocks, including older work if this session only has one block.",
          model: MODEL,
          workspace,
          sessionId: currentId,
          permissionMode: "yolo",
          toolAllowlist: ["recent_activity"],
          disablePersistentMemory: true,
          signal: controller.signal,
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
        });

        const toolStart = findToolStart(events);
        const toolEnd = findToolEnd(events);

        assertEquals(!!toolStart, true, "LLM must call recent_activity");
        assertEquals(toolEnd?.success, true, "tool must succeed");

        // Must contain BOTH sessions' data
        assertStringIncludes(toolEnd!.content, "fix the login page CSS bug");
        assertStringIncludes(toolEnd!.content, "write integration tests");

        // Must label sources correctly
        assertStringIncludes(toolEnd!.content, "current_session");
        assertStringIncludes(toolEnd!.content, "other_session");
      });
    });
  },
});

// ============================================================
// Test 4: a natural yesterday question routes to reference=yesterday
// ============================================================

Deno.test({
  name: "E2E real LLM: Claude routes a natural yesterday question to the yesterday reference",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRecentActivityTest(async ({ controller }) => {
      const sessionId = "e2e-yesterday";
      const todayKey = getLocalDateKey(Date.now(), TIME_ZONE);
      const yesterdayKey = getLocalDateKey(Date.now() - DAY_MS, TIME_ZONE);
      const yesterdayTs = findUtcTimestampForLocal(yesterdayKey, 11, 0);
      const todayTs = findUtcTimestampForLocal(todayKey, 11, 0);

      seedSession(sessionId, [
        { content: "investigate flaky GraphQL test", created_at: new Date(yesterdayTs).toISOString() },
        { content: "polish release notes draft", created_at: new Date(todayTs).toISOString() },
      ]);

      await withIsolatedEnv(async (workspace) => {
        const events: AgentUIEvent[] = [];

        await runAgentQuery({
          query: "What were we working on yesterday?",
          model: MODEL,
          workspace,
          sessionId,
          permissionMode: "yolo",
          toolAllowlist: ["recent_activity"],
          disablePersistentMemory: true,
          signal: controller.signal,
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
        });

        const toolStart = findToolStart(events);
        const toolEnd = findToolEnd(events);

        assertEquals(toolEnd?.success, true, "tool must succeed");
        assertStringIncludes(
          toolStart!.argsSummary,
          "yesterday",
          `LLM must call with reference=yesterday (got: ${toolStart?.argsSummary})`,
        );
        assertStringIncludes(toolEnd!.content, "investigate flaky GraphQL test");
        assertEquals(
          toolEnd!.content.includes("polish release notes draft"),
          false,
          "yesterday lookup must exclude today's block",
        );
      });
    });
  },
});

// ============================================================
// Test 5: before_that navigates to the correct older block
// ============================================================

Deno.test({
  name: "E2E real LLM: before_that returns the older block, not the newest",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRecentActivityTest(async ({ controller }) => {
      const sessionId = "e2e-before-that";
      // Only seed meaningful prompts — recall-meta prompts are provided
      // via messageHistory for the LLM's multi-turn context. Seeding them
      // here too would inflate trailingMetaCount and overshoot the block index.
      seedSession(sessionId, [
        { content: "research Python asyncio patterns", created_at: "2026-03-09T14:00:00Z" },
        { content: "clean up Downloads folder", created_at: "2026-03-10T09:00:00Z" },
      ]);

      await withIsolatedEnv(async (workspace) => {
        const events: AgentUIEvent[] = [];

        // Multi-turn: inject prior exchange where last_time was already answered.
        // Without this context, the LLM correctly interprets "before that" as
        // "last time" since there's nothing to be "before" yet.
        const messageHistory = [
          { role: "user" as const, content: "what did I do last time?" },
          {
            role: "assistant" as const,
            content:
              "Based on recent_activity, you were cleaning up your Downloads folder on March 10.",
          },
        ];

        await runAgentQuery({
          query: "and before that?",
          model: MODEL,
          workspace,
          sessionId,
          permissionMode: "yolo",
          toolAllowlist: ["recent_activity"],
          disablePersistentMemory: true,
          signal: controller.signal,
          messageHistory,
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
        });

        const toolStart = events.find(
          (e): e is Extract<AgentUIEvent, { type: "tool_start" }> =>
            e.type === "tool_start" && e.name === "recent_activity",
        );
        const toolEnd = events.find(
          (e): e is Extract<AgentUIEvent, { type: "tool_end" }> =>
            e.type === "tool_end" && e.name === "recent_activity",
        );

        assertEquals(toolEnd!.success, true, "tool must succeed");

        // Verify the LLM actually called with before_that
        assertStringIncludes(
          toolStart!.argsSummary,
          "before_that",
          `LLM must call with reference=before_that (got: ${toolStart!.argsSummary})`,
        );

        // CRITICAL: before_that must return the OLDER block (Python asyncio)
        assertStringIncludes(
          toolEnd!.content,
          "research Python asyncio",
          `before_that must return the older block (got: ${toolEnd!.content.slice(0, 200)})`,
        );

        // Must NOT contain the newest meaningful block (Downloads)
        assertEquals(
          toolEnd!.content.includes("clean up Downloads"),
          false,
          "before_that must skip past the most recent block",
        );
      });
    });
  },
});
