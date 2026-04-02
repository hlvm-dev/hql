/**
 * Delegate transcript snapshot helpers.
 *
 * Captures a compact, serializable view of a delegated child run for UI/debugging.
 */

import { truncate } from "../../common/utils.ts";

export type DelegateTranscriptEvent =
  | { type: "reasoning"; iteration: number; summary: string }
  | { type: "planning"; iteration: number; summary: string }
  | { type: "plan_created"; stepCount: number }
  | { type: "plan_step"; stepId: string; index: number; completed: boolean }
  | {
    type: "tool_start";
    name: string;
    argsSummary: string;
    toolIndex: number;
    toolTotal: number;
  }
  | {
    type: "tool_end";
    name: string;
    success: boolean;
    content?: string;
    summary?: string;
    durationMs: number;
    argsSummary: string;
  }
  | {
    type: "tool_progress";
    name: string;
    argsSummary: string;
    message: string;
  }
  | {
    type: "turn_stats";
    iteration: number;
    toolCount: number;
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
  };

export interface DelegateTranscriptSnapshot {
  agent: string;
  task: string;
  childSessionId?: string;
  success: boolean;
  durationMs: number;
  toolCount: number;
  finalResponse?: string;
  error?: string;
  events: DelegateTranscriptEvent[];
}

const DELEGATE_TRANSCRIPT_SNAPSHOT = Symbol("delegate_transcript_snapshot");

type SnapshotCarrier = {
  [DELEGATE_TRANSCRIPT_SNAPSHOT]?: DelegateTranscriptSnapshot;
};

export function withDelegateTranscriptSnapshot(
  value: unknown,
  snapshot: DelegateTranscriptSnapshot,
): unknown {
  if (value && typeof value === "object") {
    (value as SnapshotCarrier)[DELEGATE_TRANSCRIPT_SNAPSHOT] = snapshot;
    return value;
  }
  return {
    value,
    [DELEGATE_TRANSCRIPT_SNAPSHOT]: snapshot,
  };
}

export function getDelegateTranscriptSnapshot(
  value: unknown,
): DelegateTranscriptSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  return (value as SnapshotCarrier)[DELEGATE_TRANSCRIPT_SNAPSHOT];
}

function formatDelegateDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function summarizeDelegateToolContent(
  name: string,
  summary?: string,
  content?: string,
): string {
  const candidate = summary?.trim();
  if (candidate) return candidate;
  const normalized = (content ?? "").trim();
  if (!normalized) return `${name} completed`;
  return normalized.split("\n").map((line) => line.trim()).find(Boolean) ??
    normalized;
}

export function formatDelegateTranscriptEvent(
  event: DelegateTranscriptEvent,
): string {
  switch (event.type) {
    case "reasoning":
      return `Reasoning: ${event.summary.trim()}`;
    case "planning":
      return `Planning: ${event.summary.trim()}`;
    case "plan_created":
      return `Plan created (${event.stepCount} steps)`;
    case "plan_step":
      return `Plan step ${event.index + 1} complete: ${event.stepId}`;
    case "tool_start":
      return `Tool ${event.name}: ${event.argsSummary}`;
    case "tool_progress":
      return `Tool ${event.name}: ${event.message.trim()}`;
    case "tool_end": {
      const summary = summarizeDelegateToolContent(
        event.name,
        event.summary,
        event.content,
      );
      return event.success
        ? `Tool ${event.name}: ${summary}`
        : `Tool ${event.name} failed: ${summary}`;
    }
    case "turn_stats":
      return `${event.toolCount} tool${event.toolCount === 1 ? "" : "s"} · ${
        formatDelegateDurationMs(event.durationMs)
      }`;
  }
}

export function listDelegateTranscriptLines(
  snapshot?: DelegateTranscriptSnapshot,
): string[] {
  if (!snapshot) return [];
  const eventLines = snapshot.events
    .map(formatDelegateTranscriptEvent)
    .filter(Boolean);
  const finalLine = snapshot.finalResponse?.trim()
    ? `Final: ${truncate(snapshot.finalResponse.trim(), 120)}`
    : undefined;
  return finalLine ? [...eventLines, finalLine] : eventLines;
}
