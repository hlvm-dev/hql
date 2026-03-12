/**
 * Delegate transcript snapshot helpers.
 *
 * Captures a compact, serializable view of a delegated child run for UI/debugging.
 */

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
