import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  combineSignals,
  isAbortError,
  TimeoutError,
  withTimeout,
} from "../../../src/common/timeout-utils.ts";

Deno.test("TimeoutUtils: withTimeout returns the operation result and passes a live signal", async () => {
  let signalWasAborted: boolean | null = null;

  const result = await withTimeout(
    async (signal) => {
      signalWasAborted = signal.aborted;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "success";
    },
    { timeoutMs: 1000, label: "test" },
  );

  assertEquals(result, "success");
  assertEquals(signalWasAborted, false);
});

Deno.test("TimeoutUtils: withTimeout aborts slow operations and throws TimeoutError", async () => {
  let signalObservedAbort = false;

  await assertRejects(
    async () => {
      await withTimeout(
        async (signal) => {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 200);
            signal.addEventListener("abort", () => {
              signalObservedAbort = signal.aborted;
              clearTimeout(timer);
              reject(new Error("Aborted"));
            }, { once: true });
          });
          return "unreachable";
        },
        { timeoutMs: 50, label: "slow operation" },
      );
    },
    TimeoutError,
    "slow operation timed out after 50ms",
  );

  assertEquals(signalObservedAbort, true);
});

Deno.test("TimeoutUtils: withTimeout propagates operation errors and parent-signal cancellation", async () => {
  await assertRejects(
    () => withTimeout(async () => {
      throw new Error("operation failed");
    }, { timeoutMs: 1000, label: "test" }),
    Error,
    "operation failed",
  );

  const parentController = new AbortController();
  let signalObservedAbort = false;
  const promise = withTimeout(
    async (signal) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 500);
        signal.addEventListener("abort", () => {
          signalObservedAbort = signal.aborted;
          clearTimeout(timer);
          reject(new Error("Aborted by signal"));
        }, { once: true });
      });
      return "done";
    },
    {
      timeoutMs: 1000,
      signal: parentController.signal,
      label: "parent abort",
    },
  );

  setTimeout(() => parentController.abort(), 50);
  await assertRejects(() => promise, Error);
  assertEquals(signalObservedAbort, true);
});

Deno.test("TimeoutUtils: combineSignals supports single passthrough and multi-signal OR semantics", async () => {
  const singleController = new AbortController();
  const single = combineSignals(singleController.signal);
  assertEquals(single.aborted, false);
  singleController.abort(new Error("single"));
  assertEquals(single.aborted, true);
  assertEquals(single.reason instanceof Error, true);

  const controller1 = new AbortController();
  const controller2 = new AbortController();
  const combined = combineSignals(controller1.signal, controller2.signal);
  assertEquals(combined.aborted, false);
  controller2.abort(new Error("combined"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(combined.aborted, true);
  assertEquals((combined.reason as Error).message, "combined");
});

Deno.test("TimeoutUtils: isAbortError classifies timeout and abort-shaped errors only", () => {
  const abortByName = new Error("aborted");
  abortByName.name = "AbortError";

  assertEquals(isAbortError(new TimeoutError("test", 1000)), true);
  assertEquals(isAbortError(abortByName), true);
  assertEquals(isAbortError(new Error("operation was aborted")), true);
  assertEquals(isAbortError(new Error("network error")), false);
  assertEquals(isAbortError("string error"), false);
  assertEquals(isAbortError(null), false);
});

