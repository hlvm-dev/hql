/**
 * Task Manager
 *
 * Manages background tasks with observable pattern for React integration.
 * Supports concurrent model downloads with progress tracking and cancellation.
 *
 * Design principles:
 * 1. Single source of truth for task state
 * 2. Observable pattern compatible with useSyncExternalStore
 * 3. Microtask batching for rapid updates (like ReplState)
 * 4. Full cancellation support via AbortController
 */

import {
  type Task,
  type TaskStatus,
  type TaskEvent,
  type TaskEventListener,
  type ModelPullTask,
  type PullProgress,
  type EvalTask,
  type EvalProgress,
  canTransition,
} from "./types.ts";

// ============================================================
// Resource Registry
// ============================================================

/**
 * Unified resource tracking and cleanup.
 * Ensures all AbortControllers and cleanup functions are properly managed.
 */
class ResourceRegistry {
  private controllers = new Map<string, AbortController>();
  private cleanupFns = new Set<() => void>();
  private isShuttingDown = false;

  /** Register an abort controller for a task */
  register(id: string, controller: AbortController): void {
    if (this.isShuttingDown) {
      // If shutting down, immediately abort
      controller.abort();
      return;
    }
    this.controllers.set(id, controller);
  }

  /** Unregister and optionally abort a controller */
  unregister(id: string, abort = false): void {
    const controller = this.controllers.get(id);
    if (controller) {
      if (abort && !controller.signal.aborted) {
        controller.abort();
      }
      this.controllers.delete(id);
    }
  }

  /** Get a controller by ID */
  get(id: string): AbortController | undefined {
    return this.controllers.get(id);
  }

  /** Check if a controller exists and is not aborted */
  isActive(id: string): boolean {
    const controller = this.controllers.get(id);
    return controller != null && !controller.signal.aborted;
  }

  /** Register a cleanup function to run on shutdown */
  onCleanup(fn: () => void): () => void {
    this.cleanupFns.add(fn);
    return () => this.cleanupFns.delete(fn);
  }

  /** Shutdown - abort all and run cleanup */
  shutdown(): void {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    // Abort all active controllers
    for (const [_id, controller] of this.controllers) {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }
    this.controllers.clear();

    // Run cleanup functions
    for (const fn of this.cleanupFns) {
      try {
        fn();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.cleanupFns.clear();
  }

  /** Check if shutdown is in progress */
  get shuttingDown(): boolean {
    return this.isShuttingDown;
  }

  /** Reset for testing */
  reset(): void {
    this.isShuttingDown = false;
    this.controllers.clear();
    this.cleanupFns.clear();
  }
}

// ============================================================
// TaskManager Class
// ============================================================

export class TaskManager {
  private tasks = new Map<string, Task>();
  private resources = new ResourceRegistry();

  // Observable pattern (same as ReplState)
  private listeners = new Set<() => void>();
  private eventListeners = new Set<TaskEventListener>();
  private version = 0;
  private notifyPending = false;

  // Configuration
  private endpoint: string;

  constructor(endpoint: string = "http://127.0.0.1:11434") {
    this.endpoint = endpoint;
  }

  // ============================================================
  // Observable Pattern (useSyncExternalStore compatible)
  // ============================================================

  /** Subscribe to state changes */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Get snapshot version for React */
  getSnapshot = (): number => this.version;

  /**
   * Notify listeners with microtask batching.
   * Same pattern as ReplState - prevents "Maximum update depth" warnings.
   */
  private notify(): void {
    this.version++;
    if (this.notifyPending) return;
    this.notifyPending = true;
    queueMicrotask(() => {
      this.notifyPending = false;
      for (const listener of this.listeners) {
        listener();
      }
    });
  }

  // ============================================================
  // Event System
  // ============================================================

  /** Subscribe to specific task events */
  onEvent(listener: TaskEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Emit event to all listeners */
  private emit(event: TaskEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  // ============================================================
  // State Machine
  // ============================================================

  /**
   * Transition a task to a new state with validation.
   * Returns false if the transition is invalid.
   * All state changes go through this method to prevent race conditions.
   */
  private transition(taskId: string, newStatus: TaskStatus): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // Validate transition
    if (!canTransition(task.status, newStatus)) {
      console.warn(`[TaskManager] Invalid transition: ${task.status} → ${newStatus} for task ${taskId}`);
      return false;
    }

    // Create immutable updated task
    const updatedTask = Object.freeze({
      ...task,
      status: newStatus,
      ...(newStatus !== "pending" && newStatus !== "running" ? { completedAt: Date.now() } : {}),
      ...(newStatus === "running" ? { startedAt: Date.now() } : {}),
    });

    this.tasks.set(taskId, updatedTask);
    this.notify();
    return true;
  }

  /**
   * Update progress for a model pull task (immutable).
   * Creates a new frozen task object to ensure React detects the change.
   */
  private updateProgress(taskId: string, progress: Partial<PullProgress>): void {
    const task = this.tasks.get(taskId) as ModelPullTask | undefined;
    if (!task || task.type !== "model-pull") return;

    // Calculate percent safely (prevent NaN/division by zero)
    let percent = task.progress?.percent ?? 0;
    if (progress.total && progress.total > 0 && progress.completed != null) {
      percent = Math.round((progress.completed / progress.total) * 100);
      if (isNaN(percent)) percent = 0;
    }

    // Create immutable updated task
    const updatedTask: ModelPullTask = Object.freeze({
      ...task,
      progress: Object.freeze({
        ...task.progress,
        ...progress,
        percent,
      }),
    });

    this.tasks.set(taskId, updatedTask);
    this.notify();
    this.emit({ type: "task:progress", taskId, progress: updatedTask.progress });
  }

  /**
   * Set error on a failed task (immutable).
   */
  private setError(taskId: string, error: Error): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const updatedTask = Object.freeze({
      ...task,
      error,
    });

    this.tasks.set(taskId, updatedTask);
    this.notify();
  }

  // ============================================================
  // Query Operations
  // ============================================================

  /** Get all tasks */
  getTasks(): ReadonlyMap<string, Task> {
    return this.tasks;
  }

  /** Get task by ID */
  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  /** Get count of active tasks (pending or running) */
  getActiveCount(): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === "running" || task.status === "pending") {
        count++;
      }
    }
    return count;
  }

  /** Check if a specific model is currently being pulled */
  isModelPulling(modelName: string): boolean {
    for (const task of this.tasks.values()) {
      if (
        task.type === "model-pull" &&
        (task as ModelPullTask).modelName === modelName &&
        (task.status === "running" || task.status === "pending")
      ) {
        return true;
      }
    }
    return false;
  }

  /** Update endpoint */
  setEndpoint(endpoint: string): void {
    this.endpoint = endpoint;
  }

  /** Get current endpoint */
  getEndpoint(): string {
    return this.endpoint;
  }

  // ============================================================
  // Model Pull Operations
  // ============================================================

  /**
   * Start pulling a model from Ollama.
   * Returns task ID immediately, download runs in background.
   */
  pullModel(modelName: string): string {
    // Validate input
    if (!modelName?.trim()) {
      throw new Error("Model name is required");
    }

    const normalizedName = modelName.trim();

    // Prevent duplicate downloads
    if (this.isModelPulling(normalizedName)) {
      throw new Error(`Model ${normalizedName} is already being pulled`);
    }

    // Check if shutting down
    if (this.resources.shuttingDown) {
      throw new Error("TaskManager is shutting down");
    }

    const id = crypto.randomUUID();
    const abortController = new AbortController();

    // Create immutable task
    const task: ModelPullTask = Object.freeze({
      id,
      type: "model-pull" as const,
      label: `Pulling ${normalizedName}`,
      status: "pending" as const,
      createdAt: Date.now(),
      modelName: normalizedName,
      progress: Object.freeze({ status: "pending" }),
    });

    this.tasks.set(id, task);
    this.resources.register(id, abortController);
    this.notify();
    this.emit({ type: "task:created", task });

    // Start download in background (non-blocking)
    this.executePull(id, normalizedName, abortController.signal);

    return id;
  }

  /**
   * Execute the model pull (internal).
   * 100% SSOT: Uses ai.models.pull() API only - no fallback.
   * Uses state machine for transitions and immutable updates.
   */
  private async executePull(
    taskId: string,
    modelName: string,
    signal: AbortSignal
  ): Promise<void> {
    // Transition to running using state machine
    if (!this.transition(taskId, "running")) {
      // Invalid transition - task may have been cancelled already
      return;
    }
    this.updateProgress(taskId, { status: "starting" });
    this.emit({ type: "task:started", taskId });

    try {
      // Add timeout to prevent hanging forever
      const timeoutSignal = AbortSignal.timeout(30 * 60 * 1000); // 30 min max
      const combinedSignal = AbortSignal.any([signal, timeoutSignal]);

      // 100% SSOT: Use ai.models.pull API only - no fallback
      const aiApi = (globalThis as Record<string, unknown>).ai as {
        models: {
          pull: (name: string, provider?: string, signal?: AbortSignal) =>
            AsyncGenerator<PullProgress, void, unknown>;
        };
      } | undefined;

      if (!aiApi?.models?.pull) {
        throw new Error("AI Provider API not initialized. Cannot pull model.");
      }

      // Use API (single source of truth)
      for await (const progress of aiApi.models.pull(modelName, undefined, combinedSignal)) {
        if (signal.aborted) break;
        this.updateProgress(taskId, progress);
      }

      // Check if cancelled before marking complete
      if (signal.aborted) {
        // Only emit if transition succeeds (cancel() may have already done this)
        if (this.transition(taskId, "cancelled")) {
          this.emit({ type: "task:cancelled", taskId });
        }
        return;
      }

      // Transition to completed using state machine
      if (this.transition(taskId, "completed")) {
        this.updateProgress(taskId, { status: "done", percent: 100 });
        this.emit({ type: "task:completed", taskId });
      }
    } catch (error) {
      // Check if abort error
      if (signal.aborted || (error as Error).name === "AbortError") {
        // Only emit if transition succeeds (cancel() may have already done this)
        if (this.transition(taskId, "cancelled")) {
          this.emit({ type: "task:cancelled", taskId });
        }
        return;
      }

      // Handle timeout
      if ((error as Error).name === "TimeoutError") {
        const timeoutError = new Error("Download timed out after 30 minutes");
        this.setError(taskId, timeoutError);
        if (this.transition(taskId, "failed")) {
          this.emit({ type: "task:failed", taskId, error: timeoutError });
        }
        return;
      }

      // Transition to failed using state machine
      const taskError = error instanceof Error ? error : new Error(String(error));
      this.setError(taskId, taskError);
      if (this.transition(taskId, "failed")) {
        this.emit({ type: "task:failed", taskId, error: taskError });
      }
    } finally {
      this.resources.unregister(taskId);
    }
  }

  // ============================================================
  // HQL Eval Task Operations
  // ============================================================

  /**
   * Create an HQL evaluation task.
   * Used when pushing a running evaluation to background with Ctrl+B.
   * Returns task ID immediately; caller is responsible for tracking the promise.
   *
   * @param code - The HQL code being evaluated
   * @param controller - Optional AbortController for cancellation support.
   *                     If provided, calling cancel() will abort async operations.
   */
  createEvalTask(code: string, controller?: AbortController): string {
    if (!code?.trim()) {
      throw new Error("Code is required");
    }

    if (this.resources.shuttingDown) {
      throw new Error("TaskManager is shutting down");
    }

    const id = crypto.randomUUID();
    const preview = code.length > 50 ? code.slice(0, 47) + "..." : code;

    // Create task (note: _controller is not frozen since it's a reference)
    const task: EvalTask = {
      id,
      type: "eval" as const,
      label: `Eval: ${preview}`,
      code,
      preview,
      status: "running" as const,
      createdAt: Date.now(),
      startedAt: Date.now(),
      progress: Object.freeze({ status: "evaluating", startedAt: Date.now() }),
      _controller: controller,
    };

    this.tasks.set(id, task);
    this.notify();
    this.emit({ type: "task:created", task });

    return id;
  }

  /**
   * Complete an evaluation task with result.
   * Called when the background evaluation promise resolves.
   */
  completeEvalTask(taskId: string, result: unknown): void {
    const task = this.tasks.get(taskId);
    if (!task || task.type !== "eval") return;

    const output = typeof result === "string"
      ? result
      : (task as EvalTask).output;

    const updated: EvalTask = Object.freeze({
      ...(task as EvalTask),
      status: "completed" as const,
      completedAt: Date.now(),
      result,
      output,
      isStreaming: false,
      progress: Object.freeze({ ...(task as EvalTask).progress, status: "done" }),
    });

    this.tasks.set(taskId, updated);
    this.notify();
    this.emit({ type: "task:completed", taskId, result });
  }

  /**
   * Fail an evaluation task with error.
   * Called when the background evaluation promise rejects.
   */
  failEvalTask(taskId: string, error: Error): void {
    const task = this.tasks.get(taskId);
    if (!task || task.type !== "eval") return;

    const updated: EvalTask = Object.freeze({
      ...(task as EvalTask),
      status: "failed" as const,
      completedAt: Date.now(),
      error,
      isStreaming: false,
      progress: Object.freeze({ ...(task as EvalTask).progress, status: "failed" }),
    });

    this.tasks.set(taskId, updated);
    this.notify();
    this.emit({ type: "task:failed", taskId, error });
  }

  /**
   * Get eval task result (if completed).
   */
  getEvalResult(taskId: string): unknown | undefined {
    const task = this.tasks.get(taskId) as EvalTask | undefined;
    if (!task || task.type !== "eval" || task.status !== "completed") return undefined;
    return task.result;
  }

  /**
   * Update eval task progress.
   */
  updateEvalProgress(taskId: string, progress: Partial<EvalProgress>): void {
    const task = this.tasks.get(taskId) as EvalTask | undefined;
    if (!task || task.type !== "eval") return;

    const updated: EvalTask = Object.freeze({
      ...task,
      progress: Object.freeze({
        ...task.progress,
        ...progress,
      }),
    });

    this.tasks.set(taskId, updated);
    this.notify();
    this.emit({ type: "task:progress", taskId, progress: updated.progress });
  }

  /**
   * Update streaming output for an eval task.
   */
  updateEvalOutput(taskId: string, output: string, isStreaming: boolean): void {
    const task = this.tasks.get(taskId) as EvalTask | undefined;
    if (!task || task.type !== "eval") return;
    if (task.status !== "running") return;

    const updated: EvalTask = Object.freeze({
      ...task,
      output,
      isStreaming,
      progress: Object.freeze({
        ...task.progress,
        status: isStreaming ? "streaming" : "completing",
      }),
    });

    this.tasks.set(taskId, updated);
    this.notify();
  }

  // ============================================================
  // Cancellation Operations
  // ============================================================

  /** Cancel a specific task */
  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // For eval tasks, abort the controller if available
    if (task.type === "eval") {
      const evalTask = task as EvalTask;
      if (evalTask._controller && !evalTask._controller.signal.aborted) {
        evalTask._controller.abort();
      }
      this.transition(taskId, "cancelled");
      this.emit({ type: "task:cancelled", taskId });
      return true;
    }

    // Handle model pull tasks - abort the controller and transition state
    if (task.type === "model-pull") {
      const controller = this.resources.get(taskId);
      if (controller && !controller.signal.aborted) {
        controller.abort();
      }
      this.transition(taskId, "cancelled");
      this.emit({ type: "task:cancelled", taskId });
      return true;
    }

    // Generic fallback
    const controller = this.resources.get(taskId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /** Cancel all active tasks */
  cancelAll(): void {
    // Iterate over tasks and cancel active ones
    for (const task of this.tasks.values()) {
      if (task.status === "pending" || task.status === "running") {
        this.cancel(task.id);
      }
    }
  }

  /** Clear completed/failed/cancelled tasks from list */
  clearCompleted(): void {
    for (const [id, task] of this.tasks) {
      if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
        this.tasks.delete(id);
      }
    }
    this.notify();
  }

  /** Remove a specific task from list (only if finished) */
  removeTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status === "pending" || task.status === "running") return false;
    this.tasks.delete(taskId);
    this.notify();
    return true;
  }

  /** Shutdown - cancel all and cleanup */
  shutdown(): void {
    // Use ResourceRegistry for proper cleanup
    this.resources.shutdown();
    this.tasks.clear();
    this.listeners.clear();
    this.eventListeners.clear();
  }

  /** Register a cleanup function to run on shutdown */
  onCleanup(fn: () => void): () => void {
    return this.resources.onCleanup(fn);
  }

  /** Check if shutting down */
  isShuttingDown(): boolean {
    return this.resources.shuttingDown;
  }
}

// ============================================================
// Singleton Instance
// ============================================================

let _instance: TaskManager | null = null;
let _shutdownHandlerRegistered = false;

/**
 * Get the TaskManager singleton.
 * Creates instance on first call, reuses on subsequent calls.
 * Automatically registers shutdown handlers on first creation.
 */
export function getTaskManager(endpoint?: string): TaskManager {
  if (!_instance) {
    _instance = new TaskManager(endpoint);
    registerShutdownHandlers();
  } else if (endpoint) {
    _instance.setEndpoint(endpoint);
  }
  return _instance;
}

/**
 * Reset TaskManager singleton (for testing).
 */
export function resetTaskManager(): void {
  if (_instance) {
    _instance.shutdown();
    _instance = null;
  }
}

/**
 * Register graceful shutdown handlers for all exit paths.
 * Ensures active downloads are cancelled cleanly.
 */
function registerShutdownHandlers(): void {
  if (_shutdownHandlerRegistered) return;
  _shutdownHandlerRegistered = true;

  // Handle SIGINT (Ctrl+C)
  try {
    Deno.addSignalListener("SIGINT", () => {
      if (_instance) _instance.shutdown();
    });
  } catch {
    // Signal listeners may not be available in all environments
  }

  // Handle SIGTERM
  try {
    Deno.addSignalListener("SIGTERM", () => {
      if (_instance) _instance.shutdown();
    });
  } catch {
    // Signal listeners may not be available in all environments
  }

  // Handle process exit (beforeunload/unload)
  try {
    globalThis.addEventListener("beforeunload", () => {
      if (_instance) _instance.shutdown();
    });
    globalThis.addEventListener("unload", () => {
      if (_instance) _instance.shutdown();
    });
  } catch {
    // Event listeners may not be available in all environments
  }
}

// ============================================================
// Error Helpers
// ============================================================

/**
 * Convert technical errors to user-friendly messages.
 */
export function friendlyError(error: unknown): string {
  if (error instanceof TypeError && String(error.message).includes("fetch")) {
    return "Cannot connect to Ollama. Is it running?";
  }
  if (error instanceof Error) {
    if (error.name === "TimeoutError") {
      return "Request timed out. Try again.";
    }
    if (error.name === "AbortError") {
      return "Request was cancelled.";
    }
    if (error.message.includes("ECONNREFUSED")) {
      return "Cannot connect to Ollama. Is it running?";
    }
    return error.message;
  }
  return String(error);
}
