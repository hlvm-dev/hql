/**
 * Task Manager Module
 *
 * Background task management for HQL REPL.
 * Primarily used for model downloads with progress tracking.
 */

// Types
export type {
  TaskStatus,
  TaskType,
  PullProgress,
  Task,
  ModelPullTask,
  ModelDeleteTask,
  TaskEvent,
  TaskEventListener,
} from "./types.ts";

export {
  isModelPullTask,
  isModelDeleteTask,
  isTaskActive,
  isTaskFinished,
  canTransition,
  VALID_TRANSITIONS,
} from "./types.ts";

// TaskManager
export { TaskManager, getTaskManager, resetTaskManager, friendlyError } from "./task-manager.ts";
