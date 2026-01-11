/**
 * TaskManager Tests
 *
 * Comprehensive tests for the background task management system.
 * Covers: state machine, immutable updates, resource lifecycle, cancellation.
 */

import {
  assertEquals,
  assertThrows,
  assertExists,
} from "jsr:@std/assert@1";
import {
  TaskManager,
  resetTaskManager,
  canTransition,
  VALID_TRANSITIONS,
  friendlyError,
  isModelPullTask,
  type TaskStatus,
} from "../../src/cli/repl/task-manager/index.ts";

// ============================================================
// State Machine Tests
// ============================================================

Deno.test("canTransition: pending can transition to running", () => {
  assertEquals(canTransition("pending", "running"), true);
});

Deno.test("canTransition: pending can transition to cancelled", () => {
  assertEquals(canTransition("pending", "cancelled"), true);
});

Deno.test("canTransition: pending cannot transition to completed", () => {
  assertEquals(canTransition("pending", "completed"), false);
});

Deno.test("canTransition: running can transition to completed", () => {
  assertEquals(canTransition("running", "completed"), true);
});

Deno.test("canTransition: running can transition to failed", () => {
  assertEquals(canTransition("running", "failed"), true);
});

Deno.test("canTransition: running can transition to cancelled", () => {
  assertEquals(canTransition("running", "cancelled"), true);
});

Deno.test("canTransition: terminal states have no transitions", () => {
  const terminalStates: TaskStatus[] = ["completed", "failed", "cancelled"];
  for (const state of terminalStates) {
    assertEquals(VALID_TRANSITIONS[state].length, 0, `${state} should be terminal`);
  }
});

// ============================================================
// TaskManager Initialization Tests
// ============================================================

Deno.test("TaskManager: constructor sets default endpoint", () => {
  resetTaskManager();
  const manager = new TaskManager();
  assertEquals(manager.getEndpoint(), "http://127.0.0.1:11434");
});

Deno.test("TaskManager: constructor accepts custom endpoint", () => {
  const manager = new TaskManager("http://custom:1234");
  assertEquals(manager.getEndpoint(), "http://custom:1234");
});

Deno.test("TaskManager: setEndpoint updates endpoint", () => {
  const manager = new TaskManager();
  manager.setEndpoint("http://new:5678");
  assertEquals(manager.getEndpoint(), "http://new:5678");
});

// ============================================================
// Query Operations Tests
// ============================================================

Deno.test("TaskManager: getTasks returns empty map initially", () => {
  resetTaskManager();
  const manager = new TaskManager();
  assertEquals(manager.getTasks().size, 0);
});

Deno.test("TaskManager: getActiveCount returns 0 initially", () => {
  const manager = new TaskManager();
  assertEquals(manager.getActiveCount(), 0);
});

Deno.test("TaskManager: isModelPulling returns false for unknown model", () => {
  const manager = new TaskManager();
  assertEquals(manager.isModelPulling("unknown-model"), false);
});

// ============================================================
// Pull Model Tests
// ============================================================

Deno.test("TaskManager: pullModel rejects empty name", () => {
  const manager = new TaskManager();
  assertThrows(
    () => manager.pullModel(""),
    Error,
    "Model name is required"
  );
});

Deno.test("TaskManager: pullModel rejects whitespace-only name", () => {
  const manager = new TaskManager();
  assertThrows(
    () => manager.pullModel("   "),
    Error,
    "Model name is required"
  );
});

Deno.test("TaskManager: pullModel creates task with correct status", () => {
  const manager = new TaskManager("http://localhost:11434");
  try {
    const taskId = manager.pullModel("test-model");

    assertExists(taskId);
    const task = manager.getTask(taskId);
    assertExists(task);
    // Task should be pending or running (depends on async timing)
    assertEquals(["pending", "running"].includes(task.status), true);
  } finally {
    manager.shutdown();
  }
});

Deno.test("TaskManager: pullModel prevents duplicate downloads", () => {
  const manager = new TaskManager();
  try {
    manager.pullModel("llama3.2");

    assertThrows(
      () => manager.pullModel("llama3.2"),
      Error,
      "already being pulled"
    );
  } finally {
    manager.shutdown();
  }
});

Deno.test("TaskManager: pullModel trims model name", () => {
  const manager = new TaskManager();
  try {
    const taskId = manager.pullModel("  llama3.2  ");
    const task = manager.getTask(taskId);

    assertExists(task);
    if (isModelPullTask(task)) {
      assertEquals(task.modelName, "llama3.2");
    }
  } finally {
    manager.shutdown();
  }
});

// ============================================================
// Observable Pattern Tests
// ============================================================

Deno.test("TaskManager: subscribe returns unsubscribe function", () => {
  const manager = new TaskManager();
  const unsubscribe = manager.subscribe(() => {});
  assertEquals(typeof unsubscribe, "function");
  unsubscribe();
});

Deno.test("TaskManager: getSnapshot returns version number", () => {
  const manager = new TaskManager();
  const version = manager.getSnapshot();
  assertEquals(typeof version, "number");
});

Deno.test("TaskManager: subscribe notifies on state changes", async () => {
  const manager = new TaskManager();
  try {
    let notified = false;

    manager.subscribe(() => {
      notified = true;
    });

    manager.pullModel("test-model");

    // Wait for microtask to execute
    await new Promise((resolve) => setTimeout(resolve, 10));
    assertEquals(notified, true);
  } finally {
    manager.shutdown();
  }
});

// ============================================================
// Cancellation Tests
// ============================================================

Deno.test("TaskManager: cancel returns false for unknown task", () => {
  const manager = new TaskManager();
  assertEquals(manager.cancel("unknown-id"), false);
});

Deno.test("TaskManager: cancel returns true for active task", () => {
  const manager = new TaskManager();
  const taskId = manager.pullModel("test-model");
  const result = manager.cancel(taskId);
  assertEquals(result, true);
});

Deno.test("TaskManager: cancelAll cancels all active tasks", async () => {
  const manager = new TaskManager();
  manager.pullModel("model1");
  manager.pullModel("model2");

  assertEquals(manager.getActiveCount(), 2);
  manager.cancelAll();

  // Wait for cancellation to process
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Tasks should be cancelled (activeCount should be 0)
  assertEquals(manager.getActiveCount(), 0);
});

// ============================================================
// Clear Completed Tests
// ============================================================

Deno.test("TaskManager: clearCompleted removes finished tasks", async () => {
  const manager = new TaskManager();
  const taskId = manager.pullModel("test-model");
  manager.cancel(taskId);

  // Wait for cancellation
  await new Promise((resolve) => setTimeout(resolve, 50));

  manager.clearCompleted();
  assertEquals(manager.getTasks().size, 0);
});

Deno.test("TaskManager: removeTask returns false for unknown task", () => {
  const manager = new TaskManager();
  assertEquals(manager.removeTask("unknown-id"), false);
});

// ============================================================
// Shutdown Tests
// ============================================================

Deno.test("TaskManager: shutdown cancels all tasks", () => {
  const manager = new TaskManager();
  manager.pullModel("test-model");

  manager.shutdown();
  assertEquals(manager.getTasks().size, 0);
});

Deno.test("TaskManager: isShuttingDown returns false initially", () => {
  const manager = new TaskManager();
  assertEquals(manager.isShuttingDown(), false);
});

Deno.test("TaskManager: pullModel rejects during shutdown", () => {
  const manager = new TaskManager();
  manager.shutdown();

  assertThrows(
    () => manager.pullModel("test-model"),
    Error,
    "shutting down"
  );
});

// ============================================================
// Error Helper Tests
// ============================================================

Deno.test("friendlyError: fetch error returns connection message", () => {
  const error = new TypeError("fetch failed");
  assertEquals(friendlyError(error), "Cannot connect to Ollama. Is it running?");
});

Deno.test("friendlyError: timeout error returns timeout message", () => {
  const error = new DOMException("Request timed out", "TimeoutError");
  assertEquals(friendlyError(error), "Request timed out. Try again.");
});

Deno.test("friendlyError: abort error returns cancelled message", () => {
  const error = new DOMException("Request aborted", "AbortError");
  assertEquals(friendlyError(error), "Request was cancelled.");
});

Deno.test("friendlyError: ECONNREFUSED returns connection message", () => {
  const error = new Error("ECONNREFUSED");
  assertEquals(friendlyError(error), "Cannot connect to Ollama. Is it running?");
});

Deno.test("friendlyError: regular error returns message", () => {
  const error = new Error("Something went wrong");
  assertEquals(friendlyError(error), "Something went wrong");
});

Deno.test("friendlyError: string returns as-is", () => {
  assertEquals(friendlyError("plain text error"), "plain text error");
});

// ============================================================
// Immutable Updates Tests
// ============================================================

Deno.test("TaskManager: tasks are frozen", () => {
  const manager = new TaskManager();
  try {
    const taskId = manager.pullModel("test-model");
    const task = manager.getTask(taskId);

    assertExists(task);
    assertEquals(Object.isFrozen(task), true);
  } finally {
    manager.shutdown();
  }
});

// ============================================================
// Event System Tests
// ============================================================

Deno.test("TaskManager: onEvent returns unsubscribe function", () => {
  const manager = new TaskManager();
  const unsubscribe = manager.onEvent(() => {});
  assertEquals(typeof unsubscribe, "function");
  unsubscribe();
});

Deno.test("TaskManager: onEvent receives task:created event", async () => {
  const manager = new TaskManager();
  try {
    let receivedEvent = false;

    manager.onEvent((event) => {
      if (event.type === "task:created") {
        receivedEvent = true;
      }
    });

    manager.pullModel("test-model");

    await new Promise((resolve) => setTimeout(resolve, 10));
    assertEquals(receivedEvent, true);
  } finally {
    manager.shutdown();
  }
});

// ============================================================
// Cleanup Function Tests
// ============================================================

Deno.test("TaskManager: onCleanup returns unsubscribe function", () => {
  const manager = new TaskManager();
  const unsubscribe = manager.onCleanup(() => {});
  assertEquals(typeof unsubscribe, "function");
  unsubscribe();
});

Deno.test("TaskManager: cleanup functions run on shutdown", () => {
  const manager = new TaskManager();
  let cleanedUp = false;

  manager.onCleanup(() => {
    cleanedUp = true;
  });

  manager.shutdown();
  assertEquals(cleanedUp, true);
});
