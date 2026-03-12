import { getThread } from "./delegate-threads.ts";

type DelegateBatchStatus =
  | "running"
  | "completed"
  | "partial";

export interface DelegateBatch {
  batchId: string;
  agent: string;
  totalRows: number;
  threadIds: string[];
  /** Internal Set for O(1) membership checks on threadIds */
  _threadIdSet?: Set<string>;
  spawnFailures: number;
  createdAt: number;
  persistedSnapshot?: DelegateBatchSnapshot;
}

export interface DelegateBatchSnapshot extends DelegateBatch {
  queued: number;
  running: number;
  completed: number;
  errored: number;
  cancelled: number;
  spawned: number;
  status: DelegateBatchStatus;
}

const batches = new Map<string, DelegateBatch>();

function cloneBatchSnapshot(
  snapshot: DelegateBatchSnapshot,
): DelegateBatchSnapshot {
  const threadIds = [...snapshot.threadIds];
  return {
    ...snapshot,
    threadIds,
    _threadIdSet: new Set(threadIds),
  };
}

export function registerBatch(
  batchId: string,
  agent: string,
  totalRows: number,
): void {
  batches.set(batchId, {
    batchId,
    agent,
    totalRows,
    threadIds: [],
    _threadIdSet: new Set(),
    spawnFailures: 0,
    createdAt: Date.now(),
  });
}

export function addBatchThread(batchId: string, threadId: string): void {
  const batch = batches.get(batchId);
  if (!batch) return;
  batch._threadIdSet ??= new Set(batch.threadIds);
  if (batch._threadIdSet.has(threadId)) return;
  batch._threadIdSet.add(threadId);
  batch.threadIds.push(threadId);
}

export function addBatchSpawnFailure(batchId: string): void {
  const batch = batches.get(batchId);
  if (!batch) return;
  batch.spawnFailures += 1;
}

export function getBatchSnapshot(
  batchId: string,
): DelegateBatchSnapshot | undefined {
  const batch = batches.get(batchId);
  if (!batch) return undefined;
  const hasLiveThreads = batch.threadIds.some((threadId) => getThread(threadId));
  if (!hasLiveThreads && batch.persistedSnapshot) {
    return cloneBatchSnapshot(batch.persistedSnapshot);
  }

  let queued = 0;
  let running = 0;
  let completed = 0;
  let errored = batch.spawnFailures;
  let cancelled = 0;

  for (const threadId of batch.threadIds) {
    const thread = getThread(threadId);
    switch (thread?.status) {
      case "queued":
        queued += 1;
        break;
      case "running":
        running += 1;
        break;
      case "completed":
        completed += 1;
        break;
      case "errored":
        errored += 1;
        break;
      case "cancelled":
        cancelled += 1;
        break;
      default:
        break;
    }
  }

  const terminal = completed + errored + cancelled;
  const status: DelegateBatchStatus = terminal >= batch.totalRows
    ? (errored > 0 || cancelled > 0 ? "partial" : "completed")
    : "running";

  const snapshot: DelegateBatchSnapshot = {
    ...batch,
    queued,
    running,
    completed,
    errored,
    cancelled,
    spawned: batch.threadIds.length,
    status,
  };
  batch.persistedSnapshot = cloneBatchSnapshot(snapshot);
  return snapshot;
}

export function listBatchSnapshots(): DelegateBatchSnapshot[] {
  return [...batches.keys()]
    .map((batchId) => getBatchSnapshot(batchId))
    .filter((batch): batch is DelegateBatchSnapshot => batch !== undefined);
}

function failedBatchThreads(
  batchId: string,
): Array<{ threadId: string; task: string }> {
  const batch = batches.get(batchId);
  if (!batch) return [];
  const result: Array<{ threadId: string; task: string }> = [];
  for (const threadId of batch.threadIds) {
    const thread = getThread(threadId);
    if (thread && thread.status === "errored") {
      result.push({ threadId, task: thread.task });
    }
  }
  return result;
}

export function resetBatchRegistry(): void {
  batches.clear();
}

export function restoreBatchSnapshots(
  snapshots: readonly DelegateBatchSnapshot[],
): void {
  for (const snapshot of snapshots) {
    const threadIds = [...snapshot.threadIds];
    batches.set(snapshot.batchId, {
      batchId: snapshot.batchId,
      agent: snapshot.agent,
      totalRows: snapshot.totalRows,
      threadIds,
      _threadIdSet: new Set(threadIds),
      spawnFailures: snapshot.spawnFailures,
      createdAt: snapshot.createdAt,
      persistedSnapshot: cloneBatchSnapshot(snapshot),
    });
  }
}
