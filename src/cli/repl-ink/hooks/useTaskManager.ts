/**
 * useTaskManager Hook
 *
 * React hook for accessing TaskManager state reactively.
 * Uses useSyncExternalStore for proper external store subscription.
 *
 * Supports HQL evaluation tasks and model downloads.
 */

import { useSyncExternalStore, useMemo, useCallback } from "npm:react@18";
import {
  getTaskManager,
  type Task,
  type EvalTask,
  isTaskActive,
  isEvalTask,
} from "../../repl/task-manager/index.ts";

// ============================================================
// Types
// ============================================================

export interface UseTaskManagerReturn {
  /** All tasks */
  tasks: Task[];
  /** Eval tasks only */
  evalTasks: EvalTask[];
  /** Count of active tasks (pending or running) */
  activeCount: number;
  /** Count of completed tasks */
  completedCount: number;
  /** Create an HQL evaluation task with optional AbortController for cancellation */
  createEvalTask: (code: string, controller?: AbortController) => string;
  /** Complete an eval task with result */
  completeEvalTask: (taskId: string, result: unknown) => void;
  /** Fail an eval task with error */
  failEvalTask: (taskId: string, error: Error) => void;
  /** Get result of completed eval task */
  getEvalResult: (taskId: string) => unknown | undefined;
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
 * @returns Task state and operations
 */
export function useTaskManager(): UseTaskManagerReturn {
  // Get manager singleton
  const manager = useMemo(() => getTaskManager(), []);

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

  // Derive eval tasks
  const evalTasks = useMemo(
    () => tasks.filter(isEvalTask),
    [tasks]
  );

  // Derive counts
  const activeCount = useMemo(
    () => tasks.filter(isTaskActive).length,
    [tasks]
  );

  const completedCount = useMemo(
    () => tasks.filter((t: Task) => t.status === "completed").length,
    [tasks]
  );

  // Callbacks (stable references)
  const createEvalTask = useCallback(
    (code: string, controller?: AbortController) => manager.createEvalTask(code, controller),
    [manager]
  );

  const completeEvalTask = useCallback(
    (taskId: string, result: unknown) => manager.completeEvalTask(taskId, result),
    [manager]
  );

  const failEvalTask = useCallback(
    (taskId: string, error: Error) => manager.failEvalTask(taskId, error),
    [manager]
  );

  const getEvalResult = useCallback(
    (taskId: string) => manager.getEvalResult(taskId),
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
    evalTasks,
    activeCount,
    completedCount,
    createEvalTask,
    completeEvalTask,
    failEvalTask,
    getEvalResult,
    cancel,
    cancelAll,
    clearCompleted,
    removeTask,
  };
}
