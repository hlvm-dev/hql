export type DelegateWorkStatus =
  | "queued"
  | "running"
  | "completed"
  | "errored"
  | "cancelled";

export interface DelegateWorkItem {
  id: string;
  goal: string;
  assignedAgent: string;
  status: DelegateWorkStatus;
  threadId?: string;
  batchId?: string;
  childSessionId?: string;
  inputs?: Record<string, unknown>;
  resultSummary?: string;
  artifacts?: Record<string, unknown>;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DelegateCoordinationBoard {
  ensureItem(
    item: Omit<DelegateWorkItem, "createdAt" | "updatedAt">,
  ): DelegateWorkItem;
  attachThread(id: string, threadId: string): void;
  updateItem(
    id: string,
    patch: Partial<
      Omit<DelegateWorkItem, "id" | "goal" | "assignedAgent" | "createdAt">
    >,
  ): void;
  updateItemByThread(
    threadId: string,
    patch: Partial<
      Omit<DelegateWorkItem, "id" | "goal" | "assignedAgent" | "createdAt">
    >,
  ): void;
  getById(id: string): DelegateWorkItem | undefined;
  getByThread(threadId: string): DelegateWorkItem | undefined;
  list(): DelegateWorkItem[];
}

export function createDelegateCoordinationBoard(): DelegateCoordinationBoard {
  const items = new Map<string, DelegateWorkItem>();
  const threadIndex = new Map<string, string>();

  function touch(
    current: DelegateWorkItem,
    patch: Partial<
      Omit<DelegateWorkItem, "id" | "goal" | "assignedAgent" | "createdAt">
    >,
  ): DelegateWorkItem {
    const next: DelegateWorkItem = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    items.set(next.id, next);
    if (next.threadId) {
      threadIndex.set(next.threadId, next.id);
    }
    return next;
  }

  return {
    ensureItem(item) {
      const existing = items.get(item.id);
      if (existing) {
        return touch(existing, item);
      }
      const created: DelegateWorkItem = {
        ...item,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      items.set(created.id, created);
      if (created.threadId) {
        threadIndex.set(created.threadId, created.id);
      }
      return created;
    },
    attachThread(id, threadId) {
      const existing = items.get(id);
      if (!existing) return;
      touch(existing, { threadId });
    },
    updateItem(id, patch) {
      const existing = items.get(id);
      if (!existing) return;
      touch(existing, patch);
    },
    updateItemByThread(threadId, patch) {
      const id = threadIndex.get(threadId);
      if (!id) return;
      const existing = items.get(id);
      if (!existing) return;
      touch(existing, patch);
    },
    getById(id) {
      return items.get(id);
    },
    getByThread(threadId) {
      const id = threadIndex.get(threadId);
      return id ? items.get(id) : undefined;
    },
    list() {
      return [...items.values()];
    },
  };
}
