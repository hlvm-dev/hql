/**
 * useTaskManager Hook
 *
 * React hook for accessing TaskManager state.
 * Uses useSyncExternalStore for proper external store subscription.
 */

import { useSyncExternalStore, useMemo, useCallback } from "npm:react@18";
import {
  getTaskManager,
  type Task,
  type ModelPullTask,
  isModelPullTask,
  isTaskActive,
} from "../../repl/task-manager/index.ts";

// ============================================================
// Types
// ============================================================

export interface UseTaskManagerReturn {
  /** All tasks */
  tasks: Task[];
  /** Count of active tasks (pending or running) */
  activeCount: number;
  /** Count of completed tasks */
  completedCount: number;
  /** Active model pull tasks with progress */
  activePulls: ModelPullTask[];
  /** Check if a model is currently being pulled */
  isModelPulling: (modelName: string) => boolean;
  /** Start pulling a model */
  pullModel: (modelName: string) => string;
  /** Cancel a task */
  cancel: (taskId: string) => boolean;
  /** Cancel all tasks */
  cancelAll: () => void;
  /** Clear completed/failed/cancelled tasks */
  clearCompleted: () => void;
  /** Remove a specific task */
  removeTask: (taskId: string) => boolean;
}

// ============================================================
// Hook
// ============================================================

/**
 * Hook for accessing TaskManager state reactively.
 *
 * @param endpoint - Optional Ollama endpoint (updates TaskManager if provided)
 * @returns Task state and operations
 */
export function useTaskManager(endpoint?: string): UseTaskManagerReturn {
  // Get manager singleton (creates if needed)
  const manager = useMemo(() => getTaskManager(endpoint), [endpoint]);

  // Subscribe to state changes via useSyncExternalStore
  const version = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot // Server snapshot (same for CLI)
  );

  // Derive task list from manager (memoized on version)
  const tasks = useMemo(() => {
    void version; // Dependency
    return Array.from(manager.getTasks().values());
  }, [manager, version]);

  // Derive counts
  const activeCount = useMemo(
    () => tasks.filter(isTaskActive).length,
    [tasks]
  );

  const completedCount = useMemo(
    () => tasks.filter((t: Task) => t.status === "completed").length,
    [tasks]
  );

  // Derive active pulls
  const activePulls = useMemo(
    () =>
      tasks.filter(
        (t: Task): t is ModelPullTask => isModelPullTask(t) && isTaskActive(t)
      ),
    [tasks]
  );

  // Callbacks (stable references)
  const isModelPulling = useCallback(
    (modelName: string) => manager.isModelPulling(modelName),
    [manager]
  );

  const pullModel = useCallback(
    (modelName: string) => manager.pullModel(modelName),
    [manager]
  );

  const cancel = useCallback(
    (taskId: string) => manager.cancel(taskId),
    [manager]
  );

  const cancelAll = useCallback(() => manager.cancelAll(), [manager]);

  const clearCompleted = useCallback(() => manager.clearCompleted(), [manager]);

  const removeTask = useCallback(
    (taskId: string) => manager.removeTask(taskId),
    [manager]
  );

  return {
    tasks,
    activeCount,
    completedCount,
    activePulls,
    isModelPulling,
    pullModel,
    cancel,
    cancelAll,
    clearCompleted,
    removeTask,
  };
}
