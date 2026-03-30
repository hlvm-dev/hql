/**
 * Delegate Group Formatting — SSOT Module
 *
 * Pure functions for formatting parallel delegate group output.
 * Shared by REPL (DelegateGroup.tsx) and CLI (ask.ts).
 */

import type { DelegateGroupEntry } from "./repl-ink/types.ts";
import { listDelegateTranscriptLines } from "../agent/delegate-transcript.ts";

// ── Token Formatting ─────────────────────────────────────────
// Extracted from TurnStats.tsx for sharing across components.

/** Compact token count formatter: 420 -> "420", 2800 -> "2.8k", 12500 -> "13k", 1200000 -> "1.2M" */
export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}

// ── Group Statistics ─────────────────────────────────────────

export interface DelegateGroupStats {
  totalAgents: number;
  running: number;
  completed: number;
  errored: number;
  cancelled: number;
  queued: number;
  totalToolCount: number;
  totalTokens: number;
}

export function computeDelegateGroupStats(
  entries: readonly DelegateGroupEntry[],
): DelegateGroupStats {
  let running = 0;
  let completed = 0;
  let errored = 0;
  let cancelled = 0;
  let queued = 0;
  let totalToolCount = 0;
  let totalTokens = 0;

  for (const entry of entries) {
    switch (entry.status) {
      case "running":
        running++;
        break;
      case "success":
        completed++;
        break;
      case "error":
        errored++;
        break;
      case "cancelled":
        cancelled++;
        break;
      case "queued":
        queued++;
        break;
    }
    if (entry.snapshot) {
      totalToolCount += entry.snapshot.toolCount;
      for (const ev of entry.snapshot.events) {
        if (ev.type === "turn_stats") {
          totalTokens += (ev.inputTokens ?? 0) + (ev.outputTokens ?? 0);
        }
      }
    }
  }

  return {
    totalAgents: entries.length,
    running,
    completed,
    errored,
    cancelled,
    queued,
    totalToolCount,
    totalTokens,
  };
}

// ── Summary Formatting ───────────────────────────────────────

/** Collapsed header: "Running 3 agents... · 12 tool uses · 207.4k tokens" */
export function formatDelegateGroupSummary(stats: DelegateGroupStats): string {
  const parts: string[] = [];

  if (stats.running > 0 || stats.queued > 0) {
    if (stats.running > 0 && stats.queued > 0) {
      parts.push(`Running ${stats.running}, queued ${stats.queued}`);
    } else if (stats.queued > 0) {
      parts.push(`Queued ${stats.queued} agent${stats.queued !== 1 ? "s" : ""}…`);
    } else {
      parts.push(`Running ${stats.running} agent${stats.running !== 1 ? "s" : ""}…`);
    }
  } else if (stats.errored > 0 && stats.completed === 0) {
    parts.push(`${stats.totalAgents} agent${stats.totalAgents !== 1 ? "s" : ""} failed`);
  } else if (stats.errored > 0) {
    parts.push(`${stats.completed} done, ${stats.errored} failed`);
  } else {
    parts.push(`${stats.totalAgents} agent${stats.totalAgents !== 1 ? "s" : ""} done`);
  }

  if (stats.totalToolCount > 0) {
    parts.push(
      `${stats.totalToolCount} tool use${stats.totalToolCount !== 1 ? "s" : ""}`,
    );
  }
  if (stats.totalTokens > 0) {
    parts.push(`${formatTokens(stats.totalTokens)} tokens`);
  }

  return parts.join(" · ");
}

/** Per-agent line: "Audit code · 2 tool uses · 44.9k tokens" */
export function formatDelegateEntryLine(entry: DelegateGroupEntry): string {
  const label = entry.nickname ?? entry.agent;
  const parts: string[] = [label];

  if (entry.snapshot && entry.snapshot.toolCount > 0) {
    parts.push(
      `${entry.snapshot.toolCount} tool use${entry.snapshot.toolCount !== 1 ? "s" : ""}`,
    );
  }

  return parts.join(" · ");
}

/** Latest status for an entry: "Done", "read_file...", "Failed" */
export function getEntryLatestActivity(entry: DelegateGroupEntry): string {
  if (entry.status === "success") return "Done";
  if (entry.status === "error") return entry.error ? `Failed: ${entry.error}` : "Failed";
  if (entry.status === "cancelled") return "Cancelled";
  if (entry.status === "queued") return "Queued";

  // Running — try to get latest transcript event
  if (entry.snapshot) {
    const lines = listDelegateTranscriptLines(entry.snapshot);
    if (lines.length > 0) return lines[lines.length - 1];
  }

  return "Running…";
}

// ── Overall Group Status ─────────────────────────────────────

export type DelegateGroupStatus = "running" | "success" | "error" | "mixed";

export function getDelegateGroupStatus(
  stats: DelegateGroupStats,
): DelegateGroupStatus {
  if (stats.running > 0 || stats.queued > 0) return "running";
  if (stats.errored > 0 && stats.completed === 0) return "error";
  if (stats.errored > 0) return "mixed";
  return "success";
}

// ── CLI Full Text Formatter ──────────────────────────────────

/** Full CLI text block with tree lines for `hlvm ask` output */
export function formatDelegateGroupForCli(
  entries: readonly DelegateGroupEntry[],
  verbose: boolean,
): string {
  const stats = computeDelegateGroupStats(entries);
  const header = `↗ ${formatDelegateGroupSummary(stats)}`;

  if (!verbose) return header;

  const lines: string[] = [header];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const prefix = isLast ? "└─" : "├─";
    const childPrefix = isLast ? "   " : "│  ";
    lines.push(`${prefix} ${formatDelegateEntryLine(entry)}`);
    lines.push(`${childPrefix}└ ${getEntryLatestActivity(entry)}`);
  }

  return lines.join("\n");
}
