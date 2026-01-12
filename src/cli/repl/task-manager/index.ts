/**
 * Task Manager Module
 *
 * Background task management for HQL REPL.
 * Supports model downloads and HQL evaluations with progress tracking.
 */

// Types
export type {
  TaskStatus,
  TaskType,
  PullProgress,
  EvalProgress,
  Task,
  ModelPullTask,
  ModelDeleteTask,
  EvalTask,
  TaskEvent,
  TaskEventListener,
} from "./types.ts";

export {
  isModelPullTask,
  isModelDeleteTask,
  isEvalTask,
  isTaskActive,
  isTaskFinished,
  canTransition,
  VALID_TRANSITIONS,
} from "./types.ts";

// TaskManager
export { TaskManager, getTaskManager, resetTaskManager, friendlyError } from "./task-manager.ts";
