/**
 * Task Manager Module
 *
 * Background task management for HLVM REPL.
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
  EvalTask,
  TaskEvent,
  TaskEventListener,
} from "./types.ts";

export {
  isModelPullTask,
  isEvalTask,
  isTaskActive,
  canTransition,
  VALID_TRANSITIONS,
} from "./types.ts";

// TaskManager
export { TaskManager, getTaskManager, resetTaskManager, friendlyError } from "./task-manager.ts";
