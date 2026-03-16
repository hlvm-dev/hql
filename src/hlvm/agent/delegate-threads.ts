/**
 * Thread Registry for background delegate agents.
 *
 * Manages lifecycle of background delegation threads.
 * Translated from Codex CLI thread_manager.rs HashMap → Map.
 */

import type { DelegateTranscriptSnapshot } from "./delegate-transcript.ts";
import type {
  SandboxCapability,
  WorkspaceLeaseKind,
} from "./workspace-leases.ts";

// ============================================================
// Types
// ============================================================

type DelegateThreadStatus =
  | "queued"
  | "running"
  | "completed"
  | "errored"
  | "cancelled";

type DelegateMergeState =
  | "none"
  | "pending"
  | "applied"
  | "conflicted"
  | "discarded";

interface DelegateMergeResult {
  applied: string[];
  conflicts: string[];
}

export interface DelegateThreadResult {
  success: boolean;
  result?: unknown;
  error?: string;
  snapshot?: DelegateTranscriptSnapshot;
}

export interface DelegateThread {
  threadId: string;
  /** Top-level run owner for request-scoped cleanup. */
  ownerId?: string;
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
  /** Lease backend used for this child agent. */
  workspaceKind?: WorkspaceLeaseKind;
  /** Effective sandbox capability for this child agent. */
  sandboxCapability?: SandboxCapability;
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
  /** Merge lifecycle for child workspace changes. */
  mergeState?: DelegateMergeState;
  /** Latest merge outcome returned by wait/discard flows. */
  mergeResult?: DelegateMergeResult;
  /** Stored terminal result so wait/list paths do not need to await the raw promise again. */
  terminalResult?: DelegateThreadResult;
}

const TERMINAL_STATUSES: ReadonlySet<DelegateThreadStatus> = new Set([
  "completed",
  "errored",
  "cancelled",
]);

/** Check if a thread is still active (queued or running). */
function isThreadActive(thread: DelegateThread): boolean {
  return !TERMINAL_STATUSES.has(thread.status);
}

function isOwnedBy(thread: DelegateThread, ownerId: string): boolean {
  return thread.ownerId === ownerId;
}

function matchesOwner(
  thread: DelegateThread,
  ownerId?: string,
): boolean {
  return ownerId === undefined || isOwnedBy(thread, ownerId);
}

function hasActionableMergeState(thread: DelegateThread): boolean {
  return thread.mergeState === "pending" || thread.mergeState === "conflicted";
}

// ============================================================
// Thread Registry (singleton)
// ============================================================

const threads = new Map<string, DelegateThread>();
const completedQueue: string[] = [];
const completedQueueSet = new Set<string>();

/** DRY helper: look up a thread and apply a mutation if it exists. */
function withThread(
  threadId: string,
  mutate: (thread: DelegateThread) => void,
): void {
  const thread = threads.get(threadId);
  if (thread) mutate(thread);
}

export function registerThread(thread: DelegateThread): void {
  threads.set(thread.threadId, thread);
}

export function getThread(threadId: string): DelegateThread | undefined {
  return threads.get(threadId);
}

export function getAllThreads(): DelegateThread[] {
  return [...threads.values()];
}

export function getThreadForOwner(
  threadId: string,
  ownerId?: string,
): DelegateThread | undefined {
  const thread = getThread(threadId);
  return thread && matchesOwner(thread, ownerId) ? thread : undefined;
}

export function getThreadsForOwner(ownerId?: string): DelegateThread[] {
  return ownerId === undefined
    ? getAllThreads()
    : [...threads.values()].filter((thread) => matchesOwner(thread, ownerId));
}

export function getActiveThreadsForOwner(ownerId: string): DelegateThread[] {
  return [...threads.values()].filter((thread) =>
    isThreadActive(thread) && isOwnedBy(thread, ownerId)
  );
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
  withThread(threadId, (thread) => {
    thread.status = status;
    if (TERMINAL_STATUSES.has(status)) {
      thread.completedAt = Date.now();
    }
  });
}

export function updateThreadSnapshot(
  threadId: string,
  snapshot: DelegateTranscriptSnapshot,
): void {
  withThread(threadId, (thread) => { thread.snapshot = snapshot; });
}

export function updateThreadResult(
  threadId: string,
  result: DelegateThreadResult,
): void {
  withThread(threadId, (thread) => { thread.terminalResult = result; });
}

export function updateThreadChildSession(
  threadId: string,
  childSessionId: string,
): void {
  withThread(threadId, (thread) => { thread.childSessionId = childSessionId; });
}

export function updateThreadWorkspace(
  threadId: string,
  workspacePath: string,
  workspaceKind: WorkspaceLeaseKind,
  sandboxCapability: SandboxCapability,
  cleanup: () => Promise<void>,
): void {
  withThread(threadId, (thread) => {
    thread.workspacePath = workspacePath;
    thread.workspaceKind = workspaceKind;
    thread.sandboxCapability = sandboxCapability;
    thread.workspaceCleanup = cleanup;
  });
}

export function updateThreadDiff(
  threadId: string,
  diff: string,
  filesModified: string[],
): void {
  withThread(threadId, (thread) => {
    thread.resultDiff = diff;
    thread.filesModified = filesModified;
    if (filesModified.length > 0) thread.mergeState = "pending";
  });
}

export function updateThreadParentSnapshots(
  threadId: string,
  snapshots: Map<string, string>,
): void {
  withThread(threadId, (thread) => { thread.parentSnapshots = snapshots; });
}

export function updateThreadBatchId(
  threadId: string,
  batchId: string,
): void {
  withThread(threadId, (thread) => { thread.batchId = batchId; });
}

export function updateThreadMerge(
  threadId: string,
  mergeState: DelegateMergeState,
  mergeResult?: DelegateMergeResult,
): void {
  withThread(threadId, (thread) => {
    thread.mergeState = mergeState;
    if (mergeResult) thread.mergeResult = mergeResult;
  });
}

export function enqueueThreadCompletion(threadId: string): void {
  const thread = threads.get(threadId);
  if (
    !thread || thread.completedAt === undefined ||
    completedQueueSet.has(threadId)
  ) return;
  completedQueue.push(threadId);
  completedQueueSet.add(threadId);
}

function takeQueuedCompletedThread(): DelegateThread | undefined {
  while (completedQueue.length > 0) {
    const threadId = completedQueue.shift()!;
    completedQueueSet.delete(threadId);
    const thread = threads.get(threadId);
    if (thread?.completedAt !== undefined) {
      return thread;
    }
  }
  return undefined;
}

export function takeQueuedCompletedThreadForOwner(
  ownerId?: string,
): DelegateThread | undefined {
  if (ownerId === undefined) {
    return takeQueuedCompletedThread();
  }
  for (let index = 0; index < completedQueue.length; index++) {
    const threadId = completedQueue[index]!;
    const thread = threads.get(threadId);
    if (!thread || thread.completedAt === undefined) {
      completedQueue.splice(index, 1);
      completedQueueSet.delete(threadId);
      index--;
      continue;
    }
    if (matchesOwner(thread, ownerId)) {
      completedQueue.splice(index, 1);
      completedQueueSet.delete(threadId);
      return thread;
    }
  }
  return undefined;
}

export function clearThreadWorkspace(threadId: string): void {
  const thread = threads.get(threadId);
  if (!thread) return;
  thread.workspacePath = undefined;
  thread.workspaceKind = undefined;
  thread.sandboxCapability = undefined;
  thread.workspaceCleanup = undefined;
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

export function resolveResumableThread(
  threadId: string,
  ownerId?: string,
): { thread?: DelegateThread; error?: string } {
  const thread = getThreadForOwner(threadId, ownerId);
  if (!thread) {
    return { error: `No thread found with ID "${threadId}"` };
  }
  if (!thread.childSessionId) {
    return {
      error: `Thread "${thread.nickname}" has no persisted session to resume`,
    };
  }
  if (thread.status !== "completed" && thread.status !== "errored") {
    return {
      error:
        `Thread "${thread.nickname}" is ${thread.status} — can only resume completed/errored threads`,
    };
  }
  return { thread };
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

export function cancelThreadsForOwner(ownerId: string): void {
  for (const thread of threads.values()) {
    if (isThreadActive(thread) && isOwnedBy(thread, ownerId)) {
      thread.controller.abort();
      updateThreadStatus(thread.threadId, "cancelled");
    }
  }
}

export function removeThread(threadId: string): void {
  completedQueueSet.delete(threadId);
  threads.delete(threadId);
}

/** Max age for threads with pending/conflicted merge before force-discard + GC. */
const STALE_MERGE_AGE_MS = 2 * 60 * 60_000; // 2 hours

/**
 * Remove completed/errored/cancelled threads older than maxAgeMs,
 * retaining at most maxRetained recent terminal threads.
 * Also force-discards merge-pending threads older than STALE_MERGE_AGE_MS
 * to prevent unbounded memory accumulation.
 * Called lazily at the start of new background delegations.
 */
export function cleanupCompletedThreads(
  maxAgeMs = 30 * 60_000,
  maxRetained = 20,
): number {
  const now = Date.now();

  // Phase 1: Force-discard stale merge-pending threads so they become GC-eligible
  for (const thread of threads.values()) {
    if (
      thread.completedAt !== undefined &&
      hasActionableMergeState(thread) &&
      now - thread.completedAt > STALE_MERGE_AGE_MS
    ) {
      thread.mergeState = "discarded";
      thread.workspaceCleanup?.().catch(() => {});
      thread.workspaceCleanup = undefined;
      thread.workspacePath = undefined;
    }
  }

  // Phase 2: GC terminal threads without actionable merge state
  const terminal: DelegateThread[] = [];
  for (const thread of threads.values()) {
    if (thread.completedAt !== undefined && !hasActionableMergeState(thread)) {
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
      completedQueueSet.delete(thread.threadId);
      threads.delete(thread.threadId);
      removed++;
    }
  }
  return removed;
}

/** Reset registry (for testing). */
export function resetThreadRegistry(): void {
  threads.clear();
  completedQueue.length = 0;
  completedQueueSet.clear();
}
