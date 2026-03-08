/**
 * Thread Registry for background delegate agents.
 *
 * Manages lifecycle of background delegation threads.
 * Translated from Codex CLI thread_manager.rs HashMap → Map.
 */

import type { DelegateTranscriptSnapshot } from "./delegate-transcript.ts";

// ============================================================
// Types
// ============================================================

export type DelegateThreadStatus =
  | "queued"
  | "running"
  | "completed"
  | "errored"
  | "cancelled";

export interface DelegateThreadResult {
  success: boolean;
  result?: unknown;
  error?: string;
  snapshot?: DelegateTranscriptSnapshot;
}

export interface DelegateThread {
  threadId: string;
  agent: string;
  nickname: string;
  task: string;
  status: DelegateThreadStatus;
  controller: AbortController;
  promise: Promise<DelegateThreadResult>;
  snapshot?: DelegateTranscriptSnapshot;
  childSessionId?: string;
  completedAt?: number;
  /** Isolated workspace path for this child agent. */
  workspacePath?: string;
  /** Cleanup function to remove the isolated workspace. */
  workspaceCleanup?: () => Promise<void>;
  /** Unified diff of child's changes vs parent workspace. */
  resultDiff?: string;
  /** List of files modified by the child agent. */
  filesModified?: string[];
  /** Queued messages from parent to deliver at next iteration. */
  inputQueue?: string[];
  /** Batch ID if this thread is part of a batch_delegate fan-out. */
  batchId?: string;
  /** Snapshot of parent file contents at spawn time, for conflict detection. */
  parentSnapshots?: Map<string, string>;
}

/** Check if a thread is still active (queued or running). */
function isThreadActive(thread: DelegateThread): boolean {
  return thread.status === "queued" || thread.status === "running";
}

// ============================================================
// Thread Registry (singleton)
// ============================================================

const threads = new Map<string, DelegateThread>();

export function registerThread(thread: DelegateThread): void {
  threads.set(thread.threadId, thread);
}

export function getThread(threadId: string): DelegateThread | undefined {
  return threads.get(threadId);
}

export function getAllThreads(): DelegateThread[] {
  return [...threads.values()];
}

export function getActiveNicknames(): Set<string> {
  const nicknames = new Set<string>();
  for (const thread of threads.values()) {
    if (isThreadActive(thread)) {
      nicknames.add(thread.nickname);
    }
  }
  return nicknames;
}

export function updateThreadStatus(
  threadId: string,
  status: DelegateThreadStatus,
): void {
  const thread = threads.get(threadId);
  if (thread) {
    thread.status = status;
    if (status === "completed" || status === "errored" || status === "cancelled") {
      thread.completedAt = Date.now();
    }
  }
}

export function updateThreadSnapshot(
  threadId: string,
  snapshot: DelegateTranscriptSnapshot,
): void {
  const thread = threads.get(threadId);
  if (thread) {
    thread.snapshot = snapshot;
  }
}

export function updateThreadChildSession(
  threadId: string,
  childSessionId: string,
): void {
  const thread = threads.get(threadId);
  if (thread) {
    thread.childSessionId = childSessionId;
  }
}

export function updateThreadWorkspace(
  threadId: string,
  workspacePath: string,
  cleanup: () => Promise<void>,
): void {
  const thread = threads.get(threadId);
  if (thread) {
    thread.workspacePath = workspacePath;
    thread.workspaceCleanup = cleanup;
  }
}

export function updateThreadDiff(
  threadId: string,
  diff: string,
  filesModified: string[],
): void {
  const thread = threads.get(threadId);
  if (thread) {
    thread.resultDiff = diff;
    thread.filesModified = filesModified;
  }
}

export function updateThreadParentSnapshots(
  threadId: string,
  snapshots: Map<string, string>,
): void {
  const thread = threads.get(threadId);
  if (thread) {
    thread.parentSnapshots = snapshots;
  }
}

export function sendThreadInput(threadId: string, message: string): boolean {
  const thread = threads.get(threadId);
  if (!thread || !isThreadActive(thread)) return false;
  if (!thread.inputQueue) thread.inputQueue = [];
  thread.inputQueue.push(message);
  return true;
}

export function drainThreadInput(threadId: string): string[] {
  const thread = threads.get(threadId);
  if (!thread?.inputQueue?.length) return [];
  return thread.inputQueue.splice(0);
}

export function getBatchThreads(batchId: string): DelegateThread[] {
  const result: DelegateThread[] = [];
  for (const thread of threads.values()) {
    if (thread.batchId === batchId) result.push(thread);
  }
  return result;
}

export function cancelThread(threadId: string): boolean {
  const thread = threads.get(threadId);
  if (!thread || !isThreadActive(thread)) return false;
  thread.controller.abort();
  updateThreadStatus(threadId, "cancelled");
  return true;
}

export function cancelAllThreads(): void {
  for (const thread of threads.values()) {
    if (isThreadActive(thread)) {
      thread.controller.abort();
      updateThreadStatus(thread.threadId, "cancelled");
    }
  }
}

export function removeThread(threadId: string): void {
  threads.delete(threadId);
}

/**
 * Remove completed/errored/cancelled threads older than maxAgeMs,
 * retaining at most maxRetained recent terminal threads.
 * Called lazily at the start of new background delegations.
 */
export function cleanupCompletedThreads(
  maxAgeMs = 30 * 60_000,
  maxRetained = 20,
): number {
  const now = Date.now();
  const terminal: DelegateThread[] = [];
  for (const thread of threads.values()) {
    if (thread.completedAt !== undefined) {
      terminal.push(thread);
    }
  }
  // Sort newest first
  terminal.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  let removed = 0;
  for (let i = 0; i < terminal.length; i++) {
    const thread = terminal[i];
    const age = now - (thread.completedAt ?? 0);
    if (i >= maxRetained || age > maxAgeMs) {
      // Fire-and-forget workspace cleanup
      thread.workspaceCleanup?.().catch(() => {});
      threads.delete(thread.threadId);
      removed++;
    }
  }
  return removed;
}

/** Reset registry (for testing). */
export function resetThreadRegistry(): void {
  threads.clear();
}
