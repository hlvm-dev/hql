import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  canTransition,
  friendlyError,
  isModelPullTask,
  type EvalTask,
  TaskManager,
  VALID_TRANSITIONS,
  resetTaskManager,
} from "../../src/hlvm/cli/repl/task-manager/index.ts";
import { DEFAULT_OLLAMA_ENDPOINT } from "../../src/common/config/types.ts";
import { withRuntimeHostServer } from "../shared/light-helpers.ts";

async function withPullHost(
  fn: () => Promise<void>,
): Promise<void> {
  const installedModels = new Set<string>();

  await withRuntimeHostServer(async (req, authToken) => {
    const url = new URL(req.url);
    assertEquals(req.headers.get("Authorization"), `Bearer ${authToken}`);
    if (url.pathname === "/api/models/installed") {
      return Response.json({
        models: [...installedModels].map((name) => ({
          name,
          metadata: { provider: "ollama" },
        })),
      });
    }
    if (url.pathname === "/api/models/pull") {
      let timer: number | undefined;
      const body = await req.json() as { name?: string };
      if (body.name) {
        installedModels.add(body.name);
      }
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                event: "progress",
                status: "downloading",
                completed: 1,
                total: 2,
              }) + "\n",
            ),
          );
          timer = setTimeout(() => {
            try {
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    event: "progress",
                    status: "done",
                    completed: 2,
                    total: 2,
                  }) + "\n",
                ),
              );
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({ event: "complete", name: "ok" }) + "\n",
                ),
              );
              controller.close();
            } catch {
              // Client cancelled the pull stream.
            }
          }, 5);
        },
        cancel() {
          if (timer !== undefined) {
            clearTimeout(timer);
          }
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }
    return new Response("Not found", { status: 404 });
  }, async () => {
    await fn();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 200,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error("Timed out waiting for predicate");
}

Deno.test("TaskManager: state transitions allow only the defined lifecycle edges", () => {
  assertEquals(canTransition("pending", "running"), true);
  assertEquals(canTransition("pending", "completed"), false);
  assertEquals(canTransition("running", "completed"), true);
  assertEquals(canTransition("running", "failed"), true);
  assertEquals(canTransition("running", "cancelled"), true);

  for (const terminal of ["completed", "failed", "cancelled"] as const) {
    assertEquals(VALID_TRANSITIONS[terminal], []);
  }
});

Deno.test("TaskManager: endpoint and empty query state are initialized predictably", () => {
  resetTaskManager();
  const manager = new TaskManager();
  assertEquals(manager.getEndpoint(), DEFAULT_OLLAMA_ENDPOINT);
  assertEquals(manager.getTasks().size, 0);
  assertEquals(manager.getActiveCount(), 0);
  assertEquals(manager.isModelPulling("unknown-model"), false);

  manager.setEndpoint("http://custom:1234");
  assertEquals(manager.getEndpoint(), "http://custom:1234");
  manager.shutdown();
});

Deno.test("TaskManager: pullModel validates names, trims input, and rejects duplicates", async () => {
  await withPullHost(async () => {
    const manager = new TaskManager();
    try {
      assertThrows(() => manager.pullModel(""), Error, "Model name is required");
      assertThrows(() => manager.pullModel("   "), Error, "Model name is required");

      const taskId = manager.pullModel("  llama3.2  ");
      const task = manager.getTask(taskId);
      assertExists(task);
      assertEquals(task.status === "pending" || task.status === "running", true);
      assertEquals(manager.isModelPulling("llama3.2"), true);
      if (task && isModelPullTask(task)) {
        assertEquals(task.modelName, "llama3.2");
      }

      assertThrows(
        () => manager.pullModel("llama3.2"),
        Error,
        "already being pulled",
      );
      await waitFor(() => manager.getTask(taskId)?.status === "completed");
    } finally {
      manager.shutdown();
    }
  });
});

Deno.test({
  name: "TaskManager: pullModel emits observable updates, completes, and freezes task snapshots",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withPullHost(async () => {
      const manager = new TaskManager("http://localhost:11434");
      try {
        let notified = false;
        let createdEvent = false;
        const unsubscribe = manager.subscribe(() => {
          notified = true;
        });
        const unsubscribeEvent = manager.onEvent((event) => {
          if (event.type === "task:created") {
            createdEvent = true;
          }
        });

        const taskId = manager.pullModel("test-model");

        await waitFor(() => notified && createdEvent);
        await waitFor(() => manager.getTask(taskId)?.status === "completed");

        const task = manager.getTask(taskId);
        assertExists(task);
        assertEquals(task.status, "completed");
        assertEquals(Object.isFrozen(task), true);

        unsubscribe();
        unsubscribeEvent();
      } finally {
        manager.shutdown();
      }
    });
  },
});

Deno.test({
  name:
    "TaskManager: pullModel treats Ollama Cloud models as external availability without local pulls",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const installedModels = new Set<string>();
    let pullRequests = 0;
    let signinRequests = 0;
    let verifyRequests = 0;

    await withRuntimeHostServer(async (req, authToken) => {
      const url = new URL(req.url);
      assertEquals(req.headers.get("Authorization"), `Bearer ${authToken}`);

      if (url.pathname === "/api/models/installed") {
        return Response.json({
          models: [...installedModels].map((name) => ({
            name,
            metadata: { provider: "ollama" },
          })),
        });
      }

      if (url.pathname === "/api/models/verify-access") {
        verifyRequests += 1;
        return Response.json({ available: verifyRequests >= 2 });
      }

      if (url.pathname === "/api/providers/ollama/signin") {
        signinRequests += 1;
        return Response.json({
          success: true,
          output: ["browser opened"],
          signinUrl: null,
          browserOpened: true,
        });
      }

      if (url.pathname === "/api/models/pull") {
        pullRequests += 1;
        const body = await req.json() as { name?: string };
        if (pullRequests === 1) {
          return new Response(
            JSON.stringify({ event: "error", message: "401 Unauthorized" }) +
              "\n",
            {
              headers: { "Content-Type": "application/x-ndjson" },
            },
          );
        }

        if (body.name) {
          installedModels.add(body.name);
        }

        return new Response(
          JSON.stringify({
            event: "progress",
            status: "pulling",
            percent: 100,
          }) +
            "\n" +
            JSON.stringify({ event: "complete", name: body.name ?? "ok" }) +
            "\n",
          {
            headers: { "Content-Type": "application/x-ndjson" },
          },
        );
      }

      return new Response("Not found", { status: 404 });
    }, async () => {
      const manager = new TaskManager();
      try {
        const taskId = manager.pullModel("deepseek-v3.1:671b-cloud");
        await waitFor(() => manager.getTask(taskId)?.status === "completed", 400);

        assertEquals(pullRequests, 0);
        assertEquals(signinRequests, 0);
        assertEquals(verifyRequests, 0);
      } finally {
        manager.shutdown();
      }
    });
  },
});

Deno.test({
  name: "TaskManager: cancel, cancelAll, clearCompleted, and removeTask respect task state",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withPullHost(async () => {
      const manager = new TaskManager();
      try {
        assertEquals(manager.cancel("unknown-id"), false);

        const first = manager.pullModel("model-1");
        const second = manager.pullModel("model-2");
        assertEquals(manager.getActiveCount(), 2);

        assertEquals(manager.cancel(first), true);
        manager.cancelAll();
        await waitFor(() => manager.getActiveCount() === 0);

        const firstTask = manager.getTask(first);
        const secondTask = manager.getTask(second);
        assertExists(firstTask);
        assertExists(secondTask);
        assertEquals(firstTask.status, "cancelled");
        assertEquals(secondTask.status, "cancelled");

        assertEquals(manager.removeTask("unknown-id"), false);
        manager.clearCompleted();
        assertEquals(manager.getTasks().size, 0);

        const evalId = manager.createEvalTask('(ask "hello")');
        manager.completeEvalTask(evalId, "done");
        assertEquals(manager.removeTask(evalId), true);
      } finally {
        manager.shutdown();
      }
    });
  },
});

Deno.test("TaskManager: shutdown runs cleanup and rejects new work while shutting down", () => {
  const manager = new TaskManager();
  let cleanedUp = false;
  manager.onCleanup(() => {
    cleanedUp = true;
  });

  assertEquals(manager.isShuttingDown(), false);
  manager.shutdown();

  assertEquals(cleanedUp, true);
  assertEquals(manager.isShuttingDown(), true);
  assertThrows(() => manager.pullModel("test-model"), Error, "shutting down");
});

Deno.test("TaskManager: friendlyError maps transport and abort failures to user-facing text", () => {
  const cases = [
    [new TypeError("fetch failed"), "Cannot connect to Ollama. Is it running?"],
    [new DOMException("Request timed out", "TimeoutError"), "Request timed out. Try again."],
    [new DOMException("Request aborted", "AbortError"), "Request was cancelled."],
    [new Error("ECONNREFUSED"), "Cannot connect to Ollama. Is it running?"],
    [new Error("Something went wrong"), "Something went wrong"],
    ["plain text error", "plain text error"],
  ] as const;

  for (const [error, expected] of cases) {
    assertEquals(friendlyError(error), expected);
  }
});

Deno.test("TaskManager: eval tasks track output, completion, failure, and cancellation behavior", () => {
  const manager = new TaskManager();
  try {
    const taskId = manager.createEvalTask('(ask "hello")');
    let task = manager.getTask(taskId) as EvalTask | undefined;
    assertExists(task);
    assertEquals(task.status, "running");
    assertEquals(task.progress.status, "evaluating");

    manager.updateEvalOutput(taskId, "partial", true);
    task = manager.getTask(taskId) as EvalTask | undefined;
    assertExists(task);
    assertEquals(task.output, "partial");
    assertEquals(task.isStreaming, true);
    assertEquals(task.progress.status, "streaming");

    manager.completeEvalTask(taskId, { ok: true });
    task = manager.getTask(taskId) as EvalTask | undefined;
    assertExists(task);
    assertEquals(task.status, "completed");
    assertEquals(task.output, "partial");
    assertEquals(task.isStreaming, false);
    assertEquals(manager.getEvalResult(taskId), task.result);

    manager.updateEvalOutput(taskId, "late", true);
    assertEquals((manager.getTask(taskId) as EvalTask).output, "partial");

    const failedId = manager.createEvalTask('(ask "bye")');
    manager.updateEvalOutput(failedId, "partial", true);
    manager.failEvalTask(failedId, new Error("failure"));
    const failed = manager.getTask(failedId) as EvalTask | undefined;
    assertExists(failed);
    assertEquals(failed.status, "failed");
    assertEquals(failed.isStreaming, false);
    assertEquals(failed.progress.status, "failed");

    const controller = new AbortController();
    const cancelledId = manager.createEvalTask('(ask "cancel")', controller);
    assertEquals(manager.cancel(cancelledId), true);
    assertEquals(controller.signal.aborted, true);
    assertEquals((manager.getTask(cancelledId) as EvalTask).status, "cancelled");
  } finally {
    manager.shutdown();
  }
});
