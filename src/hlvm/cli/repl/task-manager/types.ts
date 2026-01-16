/**
 * Task Manager Types
 *
 * Type definitions for the background task management system.
 * Supports model downloads with progress tracking and cancellation.
 */

// ============================================================
// Task Status
// ============================================================

/** Task lifecycle status */
export type TaskStatus =
  | "pending"     // Task created, not yet started
  | "running"     // Task is actively executing
  | "completed"   // Task finished successfully
  | "failed"      // Task failed with error
  | "cancelled";  // Task cancelled by user

// ============================================================
// State Machine
// ============================================================

/**
 * Valid state transitions for tasks.
 * This ensures tasks can only transition through valid states,
 * preventing race conditions and invalid state changes.
 */
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["running", "cancelled"],      // Can start or be cancelled before start
  running: ["completed", "failed", "cancelled"],  // Running task can finish any way
  completed: [],  // Terminal state - no further transitions
  failed: [],     // Terminal state - no further transitions
  cancelled: [],  // Terminal state - no further transitions
};

/**
 * Check if a state transition is valid.
 * Prevents invalid state changes that could cause race conditions.
 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Task type discriminator */
export type TaskType = "model-pull" | "model-delete" | "eval";

// ============================================================
// Progress Types
// ============================================================

/** Progress information for model downloads (from Ollama /api/pull) */
export interface PullProgress {
  /** Current operation status string from Ollama */
  status: string;
  /** Current layer digest being downloaded */
  digest?: string;
  /** Total bytes to download */
  total?: number;
  /** Completed bytes */
  completed?: number;
  /** Calculated percentage (0-100) */
  percent?: number;
}

// ============================================================
// Task Types
// ============================================================

/** Base task interface */
export interface Task<T = unknown> {
  /** Unique task ID (UUID) */
  id: string;
  /** Task type discriminator */
  type: TaskType;
  /** Human-readable label (e.g., "Pulling llama3.2") */
  label: string;
  /** Current status */
  status: TaskStatus;
  /** Unix timestamp when task was created */
  createdAt: number;
  /** Unix timestamp when task started executing */
  startedAt?: number;
  /** Unix timestamp when task finished (success/fail/cancel) */
  completedAt?: number;
  /** Type-specific progress */
  progress?: PullProgress;
  /** Error if failed */
  error?: Error;
  /** Result if completed successfully */
  result?: T;
}

/** Model pull task */
export interface ModelPullTask extends Task<void> {
  type: "model-pull";
  /** Full model name (e.g., "llama3.2:7b") */
  modelName: string;
  /** Download progress */
  progress: PullProgress;
}

/** Model delete task */
export interface ModelDeleteTask extends Task<void> {
  type: "model-delete";
  /** Model name being deleted */
  modelName: string;
}


// ============================================================
// Eval Task Types (HQL Evaluation)
// ============================================================

/** Progress information for HQL evaluation tasks */
export interface EvalProgress {
  /** Current status description */
  status: string;  // "evaluating", "streaming", "completing"
  /** Unix timestamp when evaluation started */
  startedAt: number;
}

/** HQL Evaluation task - runs HQL code in background */
export interface EvalTask extends Task<unknown> {
  type: "eval";
  /** The HQL code being evaluated */
  code: string;
  /** Truncated preview for display */
  preview: string;
  /** Result value when completed */
  result?: unknown;
  /** Streamed output buffer (updated during streaming) */
  output?: string;
  /** Whether result is streaming (AsyncIterator) */
  isStreaming?: boolean;
  /** Eval-specific progress */
  progress: EvalProgress;
  /**
   * AbortController for cancellation.
   * Note: Not serializable, only available at runtime.
   * When aborted, async operations using the signal will throw AbortError.
   */
  _controller?: AbortController;
}

// ============================================================
// Event Types
// ============================================================

/** Event types for task lifecycle */
export type TaskEvent =
  | { type: "task:created"; task: Task }
  | { type: "task:started"; taskId: string }
  | { type: "task:progress"; taskId: string; progress: PullProgress | EvalProgress }
  | { type: "task:completed"; taskId: string; result?: unknown }
  | { type: "task:failed"; taskId: string; error: Error }
  | { type: "task:cancelled"; taskId: string };

/** Event listener callback */
export type TaskEventListener = (event: TaskEvent) => void;

// ============================================================
// Type Guards
// ============================================================

/** Check if task is a model pull task */
export function isModelPullTask(task: Task): task is ModelPullTask {
  return task.type === "model-pull";
}

/** Check if task is a model delete task */
export function isModelDeleteTask(task: Task): task is ModelDeleteTask {
  return task.type === "model-delete";
}


/** Check if task is an eval task */
export function isEvalTask(task: Task): task is EvalTask {
  return task.type === "eval";
}

/** Check if task is active (pending or running) */
export function isTaskActive(task: Task): boolean {
  return task.status === "pending" || task.status === "running";
}

/** Check if task is finished (completed, failed, or cancelled) */
export function isTaskFinished(task: Task): boolean {
  return task.status === "completed" || task.status === "failed" || task.status === "cancelled";
}
