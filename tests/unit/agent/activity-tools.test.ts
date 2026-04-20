import { assertEquals, assertExists } from "jsr:@std/assert";
import type { Database } from "@db/sqlite";
import { appendJsonLines } from "../../../src/common/jsonl.ts";
import {
  getHistoryPath,
  resetHlvmDirCacheForTests,
  setHlvmDirForTests,
} from "../../../src/common/paths.ts";
import {
  DAY_MS,
  getLocalDateKey,
  getLocalTimeLabel,
  getTimeZone,
} from "../../../src/common/chronology.ts";
import { ACTIVITY_TOOLS } from "../../../src/hlvm/agent/tools/activity-tools.ts";
import {
  createSession,
  insertMessage,
} from "../../../src/hlvm/store/conversation-store.ts";
import {
  _resetDbForTesting,
  _setDbForTesting,
} from "../../../src/hlvm/store/db.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withGlobalTestLock } from "../_shared/global-test-lock.ts";
import { setupStoreTestDb } from "../_shared/store-test-db.ts";

const recentActivityTool = ACTIVITY_TOOLS.recent_activity.fn;
const platform = getPlatform;
const TIME_ZONE = getTimeZone();
let currentTestDb: Database | null = null;
let currentHlvmDir: string | null = null;

interface ActivityBlock {
  date: string;
  time_range: string;
  prompts: string[];
  source: string;
  startTs: number;
  endTs: number;
}

interface ActivityResult {
  reference: string;
  subject: "activity" | "questions";
  resolved_label: string;
  blocks: ActivityBlock[];
  total_blocks: number;
  has_older: boolean;
  current_date: string;
  timezone: string;
}

async function setupTestEnv(): Promise<string> {
  _resetDbForTesting();
  currentTestDb = setupStoreTestDb();
  const tempDir = await platform().fs.makeTempDir({
    prefix: "hlvm-activity-test-",
  });
  currentHlvmDir = tempDir;
  setHlvmDirForTests(tempDir);
  return tempDir;
}

async function teardownTestEnv(tempDir: string): Promise<void> {
  currentTestDb?.close();
  currentTestDb = null;
  currentHlvmDir = null;
  _resetDbForTesting();
  resetHlvmDirCacheForTests();
  try {
    await platform().fs.remove(tempDir, { recursive: true });
  } catch {
    // best-effort
  }
}

async function withTestEnv(fn: () => Promise<void>): Promise<void> {
  await withGlobalTestLock(async () => {
    const tempDir = await setupTestEnv();
    try {
      await fn();
    } finally {
      await teardownTestEnv(tempDir);
    }
  });
}

async function recentActivity(
  args: unknown,
  options?: {
    sessionId?: string;
    currentUserRequest?: string;
  },
): Promise<ActivityResult> {
  if (currentTestDb) {
    _setDbForTesting(currentTestDb);
  }
  if (currentHlvmDir) {
    platform().env.set("HLVM_TEST_STATE_ROOT", currentHlvmDir);
    platform().env.set("HLVM_ALLOW_TEST_STATE_ROOT", "1");
    resetHlvmDirCacheForTests();
  }
  return await recentActivityTool(args, "/tmp", options) as ActivityResult;
}

function seedSession(
  id: string,
  prompts: { content: string; created_at: string }[],
): void {
  createSession("Test session", id);
  for (const prompt of prompts) {
    insertMessage({
      session_id: id,
      role: "user",
      content: prompt.content,
      sender_type: "user",
      created_at: prompt.created_at,
    });
  }
}

async function seedHistory(
  entries: { ts: number; cmd: string }[],
): Promise<void> {
  await appendJsonLines(getHistoryPath(), entries);
}

function expectedBlock(
  startTs: number,
  endTs: number,
  prompts: string[],
  source: string,
): ActivityBlock {
  return {
    date: getLocalDateKey(startTs, TIME_ZONE),
    time_range: `${getLocalTimeLabel(startTs, TIME_ZONE)} – ${
      getLocalTimeLabel(endTs, TIME_ZONE)
    }`,
    prompts,
    source,
    startTs,
    endTs,
  };
}

function viewBlocks(result: ActivityResult): ActivityBlock[] {
  return result.blocks.map((block) => ({
    date: block.date,
    time_range: block.time_range,
    prompts: [...block.prompts],
    source: block.source,
    startTs: block.startTs,
    endTs: block.endTs,
  }));
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

Deno.test({
  name:
    "recent_activity: reference=recent returns exact newest blocks in newest-first order",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestEnv(async () => {
      const sessionId = "session-recent-1";
      const blockATs = Date.parse("2026-03-11T08:00:00Z");
      const blockAEndTs = Date.parse("2026-03-11T08:05:00Z");
      const blockBTs = Date.parse("2026-03-11T10:00:00Z");
      const blockCTs = Date.parse("2026-03-11T12:00:00Z");

      seedSession(sessionId, [
        {
          content: "build React component for dashboard",
          created_at: new Date(blockATs).toISOString(),
        },
        {
          content: "add chart library to package.json",
          created_at: new Date(blockAEndTs).toISOString(),
        },
        {
          content: "deploy to staging environment",
          created_at: new Date(blockBTs).toISOString(),
        },
        {
          content: "publish release notes",
          created_at: new Date(blockCTs).toISOString(),
        },
      ]);

      const result = await recentActivity(
        { reference: "recent", limit_blocks: 3 },
        { sessionId },
      ) as ActivityResult;

      assertEquals(result.reference, "recent");
      assertEquals(result.total_blocks, 3);
      assertEquals(result.has_older, false);
      assertEquals(viewBlocks(result), [
        expectedBlock(
          blockCTs,
          blockCTs,
          ["publish release notes"],
          "current_session",
        ),
        expectedBlock(
          blockBTs,
          blockBTs,
          ["deploy to staging environment"],
          "current_session",
        ),
        expectedBlock(
          blockATs,
          blockAEndTs,
          [
            "build React component for dashboard",
            "add chart library to package.json",
          ],
          "current_session",
        ),
      ]);
    });
  },
});

Deno.test({
  name:
    "recent_activity: reference=last_time returns the exact newest meaningful block",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestEnv(async () => {
      const sessionId = "session-last-1";
      const olderTs = Date.parse("2026-03-10T14:00:00Z");
      const newestStartTs = Date.parse("2026-03-11T09:00:00Z");
      const newestEndTs = Date.parse("2026-03-11T09:04:00Z");

      seedSession(sessionId, [
        {
          content: "research Python asyncio patterns",
          created_at: new Date(olderTs).toISOString(),
        },
        {
          content: "clean up Downloads folder",
          created_at: new Date(newestStartTs).toISOString(),
        },
        {
          content: "remove old xcode zip",
          created_at: new Date(newestEndTs).toISOString(),
        },
      ]);

      const result = await recentActivity(
        { reference: "last_time" },
        { sessionId },
      ) as ActivityResult;

      assertEquals(result.reference, "last_time");
      assertEquals(result.total_blocks, 2);
      assertEquals(result.has_older, true);
      assertEquals(viewBlocks(result), [
        expectedBlock(
          newestStartTs,
          newestEndTs,
          ["clean up Downloads folder", "remove old xcode zip"],
          "current_session",
        ),
      ]);
    });
  },
});

Deno.test({
  name:
    "recent_activity: before_that skips recall-meta prompts and trailing greeting noise",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestEnv(async () => {
      const sessionId = "session-before-1";
      const oldestTs = Date.parse("2026-03-09T14:00:00Z");
      const middleTs = Date.parse("2026-03-10T09:00:00Z");
      const newestTs = Date.parse("2026-03-11T11:00:00Z");

      seedSession(sessionId, [
        {
          content: "research Python asyncio patterns",
          created_at: new Date(oldestTs).toISOString(),
        },
        {
          content: "clean up Downloads folder",
          created_at: new Date(middleTs).toISOString(),
        },
        {
          content: "deploy preview build",
          created_at: new Date(newestTs).toISOString(),
        },
        {
          content: "what did I do last time?",
          created_at: "2026-03-11T11:05:00Z",
        },
        { content: "hello", created_at: "2026-03-11T11:06:00Z" },
        { content: "and before that?", created_at: "2026-03-11T11:07:00Z" },
      ]);

      const result = await recentActivity(
        { reference: "before_that" },
        { sessionId },
      ) as ActivityResult;

      assertEquals(result.reference, "before_that");
      assertEquals(result.total_blocks, 2);
      assertEquals(result.has_older, true);
      assertEquals(viewBlocks(result), [
        expectedBlock(
          middleTs,
          middleTs,
          ["clean up Downloads folder"],
          "current_session",
        ),
      ]);
    });
  },
});

Deno.test({
  name:
    "recent_activity: before_that offset_blocks paginates older blocks exactly one block at a time",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestEnv(async () => {
      const sessionId = "session-before-offset-1";
      const oldestTs = Date.parse("2026-03-08T10:00:00Z");
      const olderTs = Date.parse("2026-03-09T10:00:00Z");
      const middleTs = Date.parse("2026-03-10T10:00:00Z");
      const newestTs = Date.parse("2026-03-11T10:00:00Z");

      seedSession(sessionId, [
        {
          content: "draft release checklist",
          created_at: new Date(oldestTs).toISOString(),
        },
        {
          content: "prepare rollback plan",
          created_at: new Date(olderTs).toISOString(),
        },
        {
          content: "review CI failures",
          created_at: new Date(middleTs).toISOString(),
        },
        {
          content: "ship hotfix build",
          created_at: new Date(newestTs).toISOString(),
        },
        {
          content: "what did I do last time?",
          created_at: "2026-03-11T10:05:00Z",
        },
        { content: "before that?", created_at: "2026-03-11T10:06:00Z" },
      ]);

      const result = await recentActivity(
        { reference: "before_that", offset_blocks: 1 },
        { sessionId },
      ) as ActivityResult;

      assertEquals(result.reference, "before_that");
      assertEquals(result.total_blocks, 3);
      assertEquals(result.has_older, true);
      assertEquals(viewBlocks(result), [
        expectedBlock(
          olderTs,
          olderTs,
          ["prepare rollback plan"],
          "current_session",
        ),
      ]);
    });
  },
});

Deno.test({
  name:
    "recent_activity: question subject returns the literal previous question instead of the latest activity block",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestEnv(async () => {
      const sessionId = "session-question-last-1";
      const olderTs = Date.parse("2026-03-10T09:00:00Z");
      const newestTs = Date.parse("2026-03-11T15:00:00Z");
      const currentQueryTs = Date.parse("2026-03-11T15:05:00Z");
      const currentUserRequest = "What did I ask last time?";

      seedSession(sessionId, [
        {
          content: "review cache metrics",
          created_at: new Date(olderTs).toISOString(),
        },
        {
          content: "ship billing fix",
          created_at: new Date(newestTs).toISOString(),
        },
        {
          content: currentUserRequest,
          created_at: new Date(currentQueryTs).toISOString(),
        },
      ]);

      const result = await recentActivity(
        { reference: "last_time", subject: "questions" },
        { sessionId, currentUserRequest },
      ) as ActivityResult;

      assertEquals(result.reference, "last_time");
      assertEquals(result.subject, "questions");
      assertEquals(result.total_blocks, 2);
      assertEquals(result.has_older, true);
      assertEquals(viewBlocks(result), [
        expectedBlock(
          newestTs,
          newestTs,
          ["ship billing fix"],
          "current_session",
        ),
      ]);
    });
  },
});

Deno.test({
  name:
    "recent_activity: question subject before_that steps back to the prior literal question",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestEnv(async () => {
      const sessionId = "session-question-before-1";
      const oldestTs = Date.parse("2026-03-10T09:00:00Z");
      const newerTs = Date.parse("2026-03-11T15:00:00Z");
      const recallTs = Date.parse("2026-03-11T15:05:00Z");
      const currentQueryTs = Date.parse("2026-03-11T15:06:00Z");
      const currentUserRequest = "before that?";

      seedSession(sessionId, [
        {
          content: "review cache metrics",
          created_at: new Date(oldestTs).toISOString(),
        },
        {
          content: "ship billing fix",
          created_at: new Date(newerTs).toISOString(),
        },
        {
          content: "What did I ask last time?",
          created_at: new Date(recallTs).toISOString(),
        },
        {
          content: currentUserRequest,
          created_at: new Date(currentQueryTs).toISOString(),
        },
      ]);

      const result = await recentActivity(
        { reference: "before_that", subject: "questions" },
        { sessionId, currentUserRequest },
      ) as ActivityResult;

      assertEquals(result.reference, "before_that");
      assertEquals(result.subject, "questions");
      assertEquals(result.total_blocks, 1);
      assertEquals(result.has_older, false);
      assertEquals(viewBlocks(result), [
        expectedBlock(
          oldestTs,
          oldestTs,
          ["review cache metrics"],
          "current_session",
        ),
      ]);
    });
  },
});

Deno.test({
  name:
    "recent_activity: question subject includes greetings and slash commands as literal prompts",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestEnv(async () => {
      const sessionId = "session-question-literal-1";
      const greetingTs = Date.parse("2026-03-11T09:00:00Z");
      const commandTs = Date.parse("2026-03-11T09:01:00Z");
      const workTs = Date.parse("2026-03-11T09:02:00Z");

      seedSession(sessionId, [
        {
          content: "hello",
          created_at: new Date(greetingTs).toISOString(),
        },
        {
          content: "/model claude-code/claude-opus-4-6",
          created_at: new Date(commandTs).toISOString(),
        },
        {
          content: "ship billing fix",
          created_at: new Date(workTs).toISOString(),
        },
      ]);

      const result = await recentActivity(
        { reference: "recent", subject: "questions", limit_blocks: 10 },
        { sessionId },
      ) as ActivityResult;

      assertEquals(result.reference, "recent");
      assertEquals(result.subject, "questions");
      assertEquals(viewBlocks(result), [
        expectedBlock(
          workTs,
          workTs,
          ["ship billing fix"],
          "current_session",
        ),
        expectedBlock(
          commandTs,
          commandTs,
          ["/model claude-code/claude-opus-4-6"],
          "current_session",
        ),
        expectedBlock(
          greetingTs,
          greetingTs,
          ["hello"],
          "current_session",
        ),
      ]);
    });
  },
});

Deno.test({
  name:
    "recent_activity: question subject deduplicates repeated user rows within the duplicate window",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestEnv(async () => {
      const sessionId = "session-question-dedup-1";
      const firstTs = Date.parse("2026-03-11T09:00:00Z");
      const duplicateTs = firstTs + 500;
      const nextTs = Date.parse("2026-03-11T09:05:00Z");

      seedSession(sessionId, [
        {
          content: "open desktop",
          created_at: new Date(firstTs).toISOString(),
        },
        {
          content: "open desktop",
          created_at: new Date(duplicateTs).toISOString(),
        },
        {
          content: "only one image",
          created_at: new Date(nextTs).toISOString(),
        },
      ]);

      const result = await recentActivity(
        { reference: "recent", subject: "questions", limit_blocks: 10 },
        { sessionId },
      ) as ActivityResult;

      assertEquals(result.reference, "recent");
      assertEquals(result.subject, "questions");
      assertEquals(viewBlocks(result), [
        expectedBlock(
          nextTs,
          nextTs,
          ["only one image"],
          "current_session",
        ),
        expectedBlock(
          firstTs,
          firstTs,
          ["open desktop"],
          "current_session",
        ),
      ]);
    });
  },
});

Deno.test({
  name:
    "recent_activity: reference=today paginates within today only and reports scoped has_older",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestEnv(async () => {
      const sessionId = "session-today-1";
      const todayKey = getLocalDateKey(Date.now(), TIME_ZONE);
      const yesterdayKey = getLocalDateKey(Date.now() - DAY_MS, TIME_ZONE);
      const yesterdayTs = findUtcTimestampForLocal(yesterdayKey, 9, 0);
      const todayMorningTs = findUtcTimestampForLocal(todayKey, 9, 0);
      const todayAfternoonTs = findUtcTimestampForLocal(todayKey, 15, 0);

      seedSession(sessionId, [
        {
          content: "audit legacy metrics snapshot",
          created_at: new Date(yesterdayTs).toISOString(),
        },
        {
          content: "review cache metrics",
          created_at: new Date(todayMorningTs).toISOString(),
        },
        {
          content: "ship billing fix",
          created_at: new Date(todayAfternoonTs).toISOString(),
        },
      ]);

      const firstPage = await recentActivity(
        { reference: "today", limit_blocks: 1 },
        { sessionId },
      ) as ActivityResult;
      const secondPage = await recentActivity(
        { reference: "today", limit_blocks: 1, offset_blocks: 1 },
        { sessionId },
      ) as ActivityResult;

      assertEquals(firstPage.total_blocks, 2);
      assertEquals(firstPage.has_older, true);
      assertEquals(viewBlocks(firstPage), [
        expectedBlock(
          todayAfternoonTs,
          todayAfternoonTs,
          ["ship billing fix"],
          "current_session",
        ),
      ]);

      assertEquals(secondPage.total_blocks, 2);
      assertEquals(secondPage.has_older, false);
      assertEquals(viewBlocks(secondPage), [
        expectedBlock(
          todayMorningTs,
          todayMorningTs,
          ["review cache metrics"],
          "current_session",
        ),
      ]);
    });
  },
});

Deno.test({
  name:
    "recent_activity: reference=yesterday returns exact yesterday blocks only",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestEnv(async () => {
      const sessionId = "session-yesterday-1";
      const yesterdayKey = getLocalDateKey(Date.now() - DAY_MS, TIME_ZONE);
      const twoDaysAgoKey = getLocalDateKey(Date.now() - 2 * DAY_MS, TIME_ZONE);
      const todayKey = getLocalDateKey(Date.now(), TIME_ZONE);
      const olderTs = findUtcTimestampForLocal(twoDaysAgoKey, 10, 0);
      const yesterdayMorningTs = findUtcTimestampForLocal(yesterdayKey, 10, 0);
      const yesterdayAfternoonTs = findUtcTimestampForLocal(
        yesterdayKey,
        14,
        0,
      );
      const todayTs = findUtcTimestampForLocal(todayKey, 8, 0);

      seedSession(sessionId, [
        {
          content: "old task from two days ago",
          created_at: new Date(olderTs).toISOString(),
        },
        {
          content: "trace GraphQL regression",
          created_at: new Date(yesterdayMorningTs).toISOString(),
        },
        {
          content: "inspect checkout API logs",
          created_at: new Date(yesterdayAfternoonTs).toISOString(),
        },
        {
          content: "draft release checklist",
          created_at: new Date(todayTs).toISOString(),
        },
      ]);

      const result = await recentActivity(
        { reference: "yesterday", limit_blocks: 10 },
        { sessionId },
      ) as ActivityResult;

      assertEquals(result.reference, "yesterday");
      assertEquals(result.total_blocks, 2);
      assertEquals(result.has_older, false);
      assertEquals(viewBlocks(result), [
        expectedBlock(
          yesterdayAfternoonTs,
          yesterdayAfternoonTs,
          ["inspect checkout API logs"],
          "current_session",
        ),
        expectedBlock(
          yesterdayMorningTs,
          yesterdayMorningTs,
          ["trace GraphQL regression"],
          "current_session",
        ),
      ]);
    });
  },
});

Deno.test({
  name:
    "recent_activity: reference=date paginates within the requested date only",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestEnv(async () => {
      const sessionId = "session-date-1";
      const olderDateTs = Date.parse("2026-03-09T14:00:00Z");
      const targetMorningTs = Date.parse("2026-03-10T09:00:00Z");
      const targetAfternoonTs = Date.parse("2026-03-10T13:00:00Z");
      const newerDateTs = Date.parse("2026-03-11T14:00:00Z");

      seedSession(sessionId, [
        {
          content: "march 9 work",
          created_at: new Date(olderDateTs).toISOString(),
        },
        {
          content: "march 10 morning work",
          created_at: new Date(targetMorningTs).toISOString(),
        },
        {
          content: "march 10 afternoon work",
          created_at: new Date(targetAfternoonTs).toISOString(),
        },
        {
          content: "march 11 work",
          created_at: new Date(newerDateTs).toISOString(),
        },
      ]);

      const firstPage = await recentActivity(
        { reference: "date", date: "2026-03-10", limit_blocks: 1 },
        { sessionId },
      ) as ActivityResult;
      const secondPage = await recentActivity(
        {
          reference: "date",
          date: "2026-03-10",
          limit_blocks: 1,
          offset_blocks: 1,
        },
        { sessionId },
      ) as ActivityResult;

      assertEquals(firstPage.total_blocks, 2);
      assertEquals(firstPage.has_older, true);
      assertEquals(viewBlocks(firstPage), [
        expectedBlock(
          targetAfternoonTs,
          targetAfternoonTs,
          ["march 10 afternoon work"],
          "current_session",
        ),
      ]);

      assertEquals(secondPage.total_blocks, 2);
      assertEquals(secondPage.has_older, false);
      assertEquals(viewBlocks(secondPage), [
        expectedBlock(
          targetMorningTs,
          targetMorningTs,
          ["march 10 morning work"],
          "current_session",
        ),
      ]);
    });
  },
});

Deno.test({
  name:
    "recent_activity: filters low-signal prompts into the exact surviving block",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestEnv(async () => {
      const sessionId = "session-filter-1";
      const startTs = Date.parse("2026-03-11T09:00:00Z");
      const endTs = Date.parse("2026-03-11T09:05:00Z");

      seedSession(sessionId, [
        {
          content: "implement user auth system",
          created_at: new Date(startTs).toISOString(),
        },
        { content: "yes", created_at: "2026-03-11T09:01:00Z" },
        { content: "hello", created_at: "2026-03-11T09:02:00Z" },
        { content: "/help", created_at: "2026-03-11T09:03:00Z" },
        { content: "ok", created_at: "2026-03-11T09:04:00Z" },
        {
          content: "add password validation",
          created_at: new Date(endTs).toISOString(),
        },
      ]);

      const result = await recentActivity(
        { reference: "recent", limit_blocks: 10 },
        { sessionId },
      ) as ActivityResult;

      assertEquals(viewBlocks(result), [
        expectedBlock(
          startTs,
          endTs,
          ["implement user auth system", "add password validation"],
          "current_session",
        ),
      ]);
    });
  },
});

Deno.test({
  name:
    "recent_activity: groups 30-minute boundary entries together but splits at 30 minutes and 1 second",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestEnv(async () => {
      const sessionId = "session-gap-1";
      const firstTs = Date.parse("2026-03-11T08:00:00Z");
      const sameBlockTs = firstTs + 30 * 60 * 1000;
      const nextBlockTs = sameBlockTs + 30 * 60 * 1000 + 1000;

      seedSession(sessionId, [
        {
          content: "same block start",
          created_at: new Date(firstTs).toISOString(),
        },
        {
          content: "same block at 30 minutes",
          created_at: new Date(sameBlockTs).toISOString(),
        },
        {
          content: "new block at 30 minutes and 1 second",
          created_at: new Date(nextBlockTs).toISOString(),
        },
      ]);

      const result = await recentActivity(
        { reference: "recent", limit_blocks: 10 },
        { sessionId },
      ) as ActivityResult;

      assertEquals(viewBlocks(result), [
        expectedBlock(
          nextBlockTs,
          nextBlockTs,
          ["new block at 30 minutes and 1 second"],
          "current_session",
        ),
        expectedBlock(
          firstTs,
          sameBlockTs,
          ["same block start", "same block at 30 minutes"],
          "current_session",
        ),
      ]);
    });
  },
});

Deno.test({
  name:
    "recent_activity: source changes split blocks even within the same time window",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestEnv(async () => {
      const currentSessionId = "session-source-current";
      const otherSessionId = "session-source-other";
      const currentTs = Date.parse("2026-03-11T10:00:00Z");
      const otherTs = Date.parse("2026-03-11T10:10:00Z");

      seedSession(currentSessionId, [
        {
          content: "fix the login page CSS bug",
          created_at: new Date(currentTs).toISOString(),
        },
      ]);
      seedSession(otherSessionId, [
        {
          content: "write integration tests for user API",
          created_at: new Date(otherTs).toISOString(),
        },
      ]);

      const result = await recentActivity(
        { reference: "recent", limit_blocks: 10 },
        { sessionId: currentSessionId },
      ) as ActivityResult;

      assertEquals(viewBlocks(result), [
        expectedBlock(
          otherTs,
          otherTs,
          ["write integration tests for user API"],
          "other_session",
        ),
        expectedBlock(
          currentTs,
          currentTs,
          ["fix the login page CSS bug"],
          "current_session",
        ),
      ]);
    });
  },
});

Deno.test({
  name:
    "recent_activity: excludes the triggering recall query when currentUserRequest is provided",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestEnv(async () => {
      const currentSessionId = "session-current-query-current";
      const otherSessionId = "session-current-query-other";
      const otherTs = Date.parse("2026-03-11T09:00:00Z");
      const currentWorkTs = Date.parse("2026-03-11T10:00:00Z");
      const currentQueryTs = Date.parse("2026-03-11T10:05:00Z");
      const currentUserRequest =
        "Walk me through what I was working on here versus earlier work.";

      seedSession(currentSessionId, [
        {
          content: "fix the login page CSS bug",
          created_at: new Date(currentWorkTs).toISOString(),
        },
        {
          content: currentUserRequest,
          created_at: new Date(currentQueryTs).toISOString(),
        },
      ]);
      seedSession(otherSessionId, [
        {
          content: "write integration tests for user API",
          created_at: new Date(otherTs).toISOString(),
        },
      ]);

      const result = await recentActivity(
        { reference: "recent", limit_blocks: 10 },
        {
          sessionId: currentSessionId,
          currentUserRequest,
        },
      ) as ActivityResult;

      assertEquals(viewBlocks(result), [
        expectedBlock(
          currentWorkTs,
          currentWorkTs,
          ["fix the login page CSS bug"],
          "current_session",
        ),
        expectedBlock(
          otherTs,
          otherTs,
          ["write integration tests for user API"],
          "other_session",
        ),
      ]);
    });
  },
});

Deno.test({
  name:
    "recent_activity: has_older for recent reflects remaining blocks after pagination",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestEnv(async () => {
      const sessionId = "session-hasolder-1";
      seedSession(sessionId, [
        { content: "task one", created_at: "2026-03-11T08:00:00Z" },
        { content: "task two", created_at: "2026-03-11T10:00:00Z" },
        { content: "task three", created_at: "2026-03-11T12:00:00Z" },
        { content: "task four", created_at: "2026-03-11T14:00:00Z" },
      ]);

      const firstPage = await recentActivity(
        { reference: "recent", limit_blocks: 2 },
        { sessionId },
      ) as ActivityResult;
      const allBlocks = await recentActivity(
        { reference: "recent", limit_blocks: 20 },
        { sessionId },
      ) as ActivityResult;

      assertEquals(firstPage.total_blocks, 4);
      assertEquals(firstPage.has_older, true);
      assertEquals(allBlocks.total_blocks, 4);
      assertEquals(allBlocks.has_older, false);
    });
  },
});

Deno.test({
  name:
    "recent_activity: handles missing sessionId with exact history-only blocks",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestEnv(async () => {
      const olderTs = Date.parse("2026-03-10T14:00:00Z");
      const newerTs = Date.parse("2026-03-11T09:00:00Z");
      await seedHistory([
        { ts: olderTs, cmd: "research Deno deploy" },
        { ts: newerTs, cmd: "update package deps" },
      ]);

      const result = await recentActivity(
        { reference: "recent", limit_blocks: 10 },
        {},
      ) as ActivityResult;

      assertEquals(viewBlocks(result), [
        expectedBlock(newerTs, newerTs, ["update package deps"], "history"),
        expectedBlock(olderTs, olderTs, ["research Deno deploy"], "history"),
      ]);
    });
  },
});

Deno.test({
  name:
    "recent_activity: deduplicates overlapping session and history entries exactly once",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTestEnv(async () => {
      const sessionId = "session-dedup-1";
      const ts = Date.parse("2026-03-11T09:00:00Z");
      seedSession(sessionId, [
        {
          content: "deduplicate this prompt",
          created_at: new Date(ts).toISOString(),
        },
      ]);
      await seedHistory([{ ts, cmd: "deduplicate this prompt" }]);

      const result = await recentActivity(
        { reference: "recent", limit_blocks: 10 },
        { sessionId },
      ) as ActivityResult;

      assertEquals(viewBlocks(result), [
        expectedBlock(
          ts,
          ts,
          ["deduplicate this prompt"],
          "current_session",
        ),
      ]);
    });
  },
});

Deno.test({
  name: "recent_activity: formatResult produces correct display",
  fn() {
    const format = ACTIVITY_TOOLS.recent_activity.formatResult!;

    const result = format({
      reference: "recent",
      subject: "activity",
      resolved_label: "Recent activity",
      blocks: [
        {
          date: "2026-03-11",
          time_range: "09:00 – 09:05",
          prompts: ["task alpha", "task beta"],
          source: "current_session",
          startTs: 0,
          endTs: 0,
        },
      ],
      total_blocks: 3,
      has_older: true,
      current_date: "2026-03-11",
      timezone: "UTC",
    });

    assertExists(result);
    assertExists(result!.summaryDisplay);
    assertExists(result!.returnDisplay);
    assertEquals(result!.summaryDisplay, "Recent activity (1 block)");
    assertEquals(result!.returnDisplay.includes("task alpha"), true);
    assertEquals(result!.summaryDisplay.includes("Activity:"), false);
  },
});

Deno.test({
  name: "recent_activity: formatResult handles empty blocks",
  fn() {
    const format = ACTIVITY_TOOLS.recent_activity.formatResult!;

    const result = format({
      reference: "yesterday",
      subject: "activity",
      resolved_label: "Activity yesterday (2026-03-10)",
      blocks: [],
      total_blocks: 0,
      has_older: false,
      current_date: "2026-03-11",
      timezone: "UTC",
    });

    assertExists(result);
    assertExists(result!.summaryDisplay);
    assertExists(result!.returnDisplay);
    assertEquals(result!.summaryDisplay, "No activity yesterday (2026-03-10)");
    assertEquals(result!.returnDisplay, "No activity yesterday (2026-03-10)");
  },
});

Deno.test({
  name: "recent_activity: formatResult makes empty recent labels explicit",
  fn() {
    const format = ACTIVITY_TOOLS.recent_activity.formatResult!;

    const result = format({
      reference: "recent",
      subject: "activity",
      resolved_label: "Recent activity",
      blocks: [],
      total_blocks: 0,
      has_older: false,
      current_date: "2026-03-11",
      timezone: "UTC",
    });

    assertExists(result);
    assertEquals(result!.summaryDisplay, "No recent activity");
    assertEquals(result!.returnDisplay, "No recent activity");
  },
});
