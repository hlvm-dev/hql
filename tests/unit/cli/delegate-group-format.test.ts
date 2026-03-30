import { assertEquals } from "jsr:@std/assert";
import {
  computeDelegateGroupStats,
  formatDelegateEntryLine,
  formatDelegateGroupForCli,
  formatDelegateGroupSummary,
  formatTokens,
  getDelegateGroupStatus,
  getEntryLatestActivity,
} from "../../../src/hlvm/cli/delegate-group-format.ts";
import type { DelegateGroupEntry } from "../../../src/hlvm/cli/repl-ink/types.ts";

function makeEntry(
  overrides: Partial<DelegateGroupEntry> & { agent: string },
): DelegateGroupEntry {
  return {
    id: `test-${overrides.agent}`,
    task: overrides.task ?? "Do something",
    status: "running",
    ...overrides,
  };
}

// ── formatTokens ─────────────────────────────────────────────

Deno.test("formatTokens: below 1k", () => {
  assertEquals(formatTokens(0), "0");
  assertEquals(formatTokens(420), "420");
  assertEquals(formatTokens(999), "999");
});

Deno.test("formatTokens: 1k–10k range", () => {
  assertEquals(formatTokens(1000), "1.0k");
  assertEquals(formatTokens(2800), "2.8k");
  assertEquals(formatTokens(9999), "10.0k");
});

Deno.test("formatTokens: 10k+ range", () => {
  assertEquals(formatTokens(10000), "10k");
  assertEquals(formatTokens(12500), "13k");
  assertEquals(formatTokens(999999), "1000k");
});

Deno.test("formatTokens: 1M+ range", () => {
  assertEquals(formatTokens(1000000), "1.0M");
  assertEquals(formatTokens(1200000), "1.2M");
});

// ── computeDelegateGroupStats ────────────────────────────────

Deno.test("computeDelegateGroupStats: mixed statuses", () => {
  const entries: DelegateGroupEntry[] = [
    makeEntry({ agent: "a", status: "running" }),
    makeEntry({ agent: "b", status: "success", snapshot: { agent: "b", task: "t", success: true, durationMs: 100, toolCount: 3, events: [] } }),
    makeEntry({ agent: "c", status: "error" }),
    makeEntry({ agent: "d", status: "queued" }),
    makeEntry({ agent: "e", status: "cancelled" }),
  ];
  const stats = computeDelegateGroupStats(entries);
  assertEquals(stats.totalAgents, 5);
  assertEquals(stats.running, 1);
  assertEquals(stats.completed, 1);
  assertEquals(stats.errored, 1);
  assertEquals(stats.queued, 1);
  assertEquals(stats.cancelled, 1);
  assertEquals(stats.totalToolCount, 3);
});

// ── formatDelegateGroupSummary ───────────────────────────────

Deno.test("formatDelegateGroupSummary: mixed running and queued", () => {
  const stats = computeDelegateGroupStats([
    makeEntry({ agent: "a", status: "running" }),
    makeEntry({ agent: "b", status: "queued" }),
  ]);
  const summary = formatDelegateGroupSummary(stats);
  assertEquals(summary.startsWith("Running 1, queued 1"), true);
});

Deno.test("formatDelegateGroupSummary: queued-only entries", () => {
  const stats = computeDelegateGroupStats([
    makeEntry({ agent: "a", status: "queued" }),
    makeEntry({ agent: "b", status: "queued" }),
  ]);
  const summary = formatDelegateGroupSummary(stats);
  assertEquals(summary.startsWith("Queued 2 agents"), true);
});

Deno.test("formatDelegateGroupSummary: running-only entries", () => {
  const stats = computeDelegateGroupStats([
    makeEntry({ agent: "a", status: "running" }),
    makeEntry({ agent: "b", status: "running" }),
  ]);
  const summary = formatDelegateGroupSummary(stats);
  assertEquals(summary.startsWith("Running 2 agents"), true);
});

Deno.test("formatDelegateGroupSummary: all done", () => {
  const stats = computeDelegateGroupStats([
    makeEntry({ agent: "a", status: "success" }),
    makeEntry({ agent: "b", status: "success" }),
  ]);
  const summary = formatDelegateGroupSummary(stats);
  assertEquals(summary, "2 agents done");
});

Deno.test("formatDelegateGroupSummary: mixed done and failed", () => {
  const stats = computeDelegateGroupStats([
    makeEntry({ agent: "a", status: "success" }),
    makeEntry({ agent: "b", status: "error" }),
  ]);
  const summary = formatDelegateGroupSummary(stats);
  assertEquals(summary, "1 done, 1 failed");
});

Deno.test("formatDelegateGroupSummary: all failed", () => {
  const stats = computeDelegateGroupStats([
    makeEntry({ agent: "a", status: "error" }),
  ]);
  const summary = formatDelegateGroupSummary(stats);
  assertEquals(summary, "1 agent failed");
});

// ── formatDelegateEntryLine ──────────────────────────────────

Deno.test("formatDelegateEntryLine: with nickname", () => {
  const line = formatDelegateEntryLine(
    makeEntry({ agent: "code_reviewer", nickname: "Audit code" }),
  );
  assertEquals(line, "Audit code");
});

Deno.test("formatDelegateEntryLine: with snapshot tools", () => {
  const line = formatDelegateEntryLine(
    makeEntry({
      agent: "reader",
      nickname: "Read files",
      snapshot: { agent: "reader", task: "t", success: true, durationMs: 100, toolCount: 10, events: [] },
    }),
  );
  assertEquals(line, "Read files · 10 tool uses");
});

Deno.test("formatDelegateEntryLine: fallback to agent name", () => {
  const line = formatDelegateEntryLine(makeEntry({ agent: "searcher" }));
  assertEquals(line, "searcher");
});

// ── getEntryLatestActivity ───────────────────────────────────

Deno.test("getEntryLatestActivity: success", () => {
  assertEquals(
    getEntryLatestActivity(makeEntry({ agent: "a", status: "success" })),
    "Done",
  );
});

Deno.test("getEntryLatestActivity: error with message", () => {
  const result = getEntryLatestActivity(
    makeEntry({ agent: "a", status: "error", error: "timeout" }),
  );
  assertEquals(result, "Failed: timeout");
});

Deno.test("getEntryLatestActivity: cancelled", () => {
  assertEquals(
    getEntryLatestActivity(makeEntry({ agent: "a", status: "cancelled" })),
    "Cancelled",
  );
});

Deno.test("getEntryLatestActivity: queued", () => {
  assertEquals(
    getEntryLatestActivity(makeEntry({ agent: "a", status: "queued" })),
    "Queued",
  );
});

Deno.test("getEntryLatestActivity: running without snapshot", () => {
  assertEquals(
    getEntryLatestActivity(makeEntry({ agent: "a", status: "running" })),
    "Running…",
  );
});

// ── getDelegateGroupStatus ───────────────────────────────────

Deno.test("getDelegateGroupStatus: running", () => {
  const stats = computeDelegateGroupStats([
    makeEntry({ agent: "a", status: "running" }),
  ]);
  assertEquals(getDelegateGroupStatus(stats), "running");
});

Deno.test("getDelegateGroupStatus: all success", () => {
  const stats = computeDelegateGroupStats([
    makeEntry({ agent: "a", status: "success" }),
  ]);
  assertEquals(getDelegateGroupStatus(stats), "success");
});

Deno.test("getDelegateGroupStatus: all error", () => {
  const stats = computeDelegateGroupStats([
    makeEntry({ agent: "a", status: "error" }),
  ]);
  assertEquals(getDelegateGroupStatus(stats), "error");
});

Deno.test("getDelegateGroupStatus: mixed", () => {
  const stats = computeDelegateGroupStats([
    makeEntry({ agent: "a", status: "success" }),
    makeEntry({ agent: "b", status: "error" }),
  ]);
  assertEquals(getDelegateGroupStatus(stats), "mixed");
});

// ── formatDelegateGroupForCli ────────────────────────────────

Deno.test("formatDelegateGroupForCli: default mode is single line", () => {
  const entries: DelegateGroupEntry[] = [
    makeEntry({ agent: "a", status: "running" }),
    makeEntry({ agent: "b", status: "success" }),
  ];
  const result = formatDelegateGroupForCli(entries, false);
  assertEquals(result.includes("\n"), false);
  assertEquals(result.startsWith("↗"), true);
});

Deno.test("formatDelegateGroupForCli: verbose mode has tree lines", () => {
  const entries: DelegateGroupEntry[] = [
    makeEntry({ agent: "a", nickname: "Alpha", status: "success" }),
    makeEntry({ agent: "b", nickname: "Beta", status: "running" }),
  ];
  const result = formatDelegateGroupForCli(entries, true);
  const lines = result.split("\n");
  assertEquals(lines.length, 5); // header + 2 entries * (entry + activity)
  assertEquals(lines[0].startsWith("↗"), true);
  assertEquals(lines[1].startsWith("├─"), true);
  assertEquals(lines[2].startsWith("│  └"), true);
  assertEquals(lines[3].startsWith("└─"), true);
  assertEquals(lines[4].startsWith("   └"), true);
});

// ── Token accumulation from turn_stats events ────────────────

Deno.test("computeDelegateGroupStats: accumulates tokens from turn_stats events", () => {
  const entries: DelegateGroupEntry[] = [
    makeEntry({
      agent: "a",
      status: "success",
      snapshot: {
        agent: "a",
        task: "t",
        success: true,
        durationMs: 100,
        toolCount: 2,
        events: [
          { type: "turn_stats", iteration: 1, toolCount: 2, durationMs: 100, inputTokens: 500, outputTokens: 200 },
        ],
      },
    }),
    makeEntry({
      agent: "b",
      status: "success",
      snapshot: {
        agent: "b",
        task: "t",
        success: true,
        durationMs: 200,
        toolCount: 1,
        events: [
          { type: "turn_stats", iteration: 1, toolCount: 1, durationMs: 200, inputTokens: 1000, outputTokens: 300 },
        ],
      },
    }),
  ];
  const stats = computeDelegateGroupStats(entries);
  assertEquals(stats.totalTokens, 2000); // 500+200+1000+300
  assertEquals(stats.totalToolCount, 3);
});

Deno.test("computeDelegateGroupStats: zero tokens when no turn_stats events", () => {
  const entries: DelegateGroupEntry[] = [
    makeEntry({
      agent: "a",
      status: "success",
      snapshot: {
        agent: "a",
        task: "t",
        success: true,
        durationMs: 100,
        toolCount: 1,
        events: [
          { type: "tool_end", name: "read_file", success: true, durationMs: 10, argsSummary: "f.ts" },
        ],
      },
    }),
  ];
  const stats = computeDelegateGroupStats(entries);
  assertEquals(stats.totalTokens, 0);
});
