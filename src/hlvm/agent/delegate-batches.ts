import { getThread } from "./delegate-threads.ts";

export type DelegateBatchStatus =
  | "running"
  | "completed"
  | "partial";

export interface DelegateBatch {
  batchId: string;
  agent: string;
  totalRows: number;
  threadIds: string[];
  spawnFailures: number;
  createdAt: number;
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
    spawnFailures: 0,
    createdAt: Date.now(),
  });
}

export function getBatch(batchId: string): DelegateBatch | undefined {
  return batches.get(batchId);
}

export function addBatchThread(batchId: string, threadId: string): void {
  const batch = batches.get(batchId);
  if (!batch || batch.threadIds.includes(threadId)) return;
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

  return {
    ...batch,
    queued,
    running,
    completed,
    errored,
    cancelled,
    spawned: batch.threadIds.length,
    status,
  };
}

export function listBatchSnapshots(): DelegateBatchSnapshot[] {
  return [...batches.keys()]
    .map((batchId) => getBatchSnapshot(batchId))
    .filter((batch): batch is DelegateBatchSnapshot => batch !== undefined);
}

export function removeBatch(batchId: string): void {
  batches.delete(batchId);
}

export function resetBatchRegistry(): void {
  batches.clear();
}
