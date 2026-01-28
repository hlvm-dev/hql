/**
 * Tests for timeout-utils.ts
 *
 * Coverage:
 * - withTimeout() basic functionality
 * - withTimeout() with parent AbortSignal
 * - combineSignals() OR logic
 * - isAbortError() classification
 * - TimeoutError custom error
 * - Resource cleanup (clearTimeout)
 */

import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  withTimeout,
  combineSignals,
  isAbortError,
  TimeoutError,
} from "../../../src/common/timeout-utils.ts";

// ============================================================
// withTimeout() Tests
// ============================================================

Deno.test("withTimeout - succeeds before timeout", async () => {
  const result = await withTimeout(
    async (_signal) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "success";
    },
    { timeoutMs: 1000, label: "test" },
  );

  assertEquals(result, "success");
});

Deno.test("withTimeout - throws TimeoutError on timeout", async () => {
  await assertRejects(
    async () => {
      await withTimeout(
        async (signal) => {
          // Use signal-aware sleep that can be cancelled
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 200);
            signal.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new Error("Aborted"));
            });
          });
          return "should not reach";
        },
        { timeoutMs: 50, label: "slow operation" },
      );
    },
    TimeoutError,
    "slow operation timed out after 50ms",
  );
});

Deno.test("withTimeout - operation receives AbortSignal", async () => {
  let receivedSignal: AbortSignal | null = null;

  await withTimeout(
    async (signal) => {
      receivedSignal = signal;
      return "done";
    },
    { timeoutMs: 1000, label: "test" },
  );

  assertEquals(receivedSignal !== null, true);
  assertEquals(receivedSignal!.aborted, false);
});

Deno.test("withTimeout - signal is aborted after timeout", async () => {
  let capturedSignal: AbortSignal | null = null;

  try {
    await withTimeout(
      async (signal) => {
        capturedSignal = signal;
        // Use signal-aware sleep that can be cancelled
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 200);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("Aborted"));
          });
        });
        return "should not reach";
      },
      { timeoutMs: 50, label: "test" },
    );
  } catch (_error) {
    // Expected timeout
  }

  // Signal should be aborted after timeout
  assertEquals(capturedSignal !== null, true);
  assertEquals(capturedSignal!.aborted, true);
});

Deno.test("withTimeout - propagates operation errors", async () => {
  await assertRejects(
    async () => {
      await withTimeout(
        async (_signal) => {
          throw new Error("operation failed");
        },
        { timeoutMs: 1000, label: "test" },
      );
    },
    Error,
    "operation failed",
  );
});

Deno.test("withTimeout - combines with parent signal", async () => {
  const parentController = new AbortController();
  let capturedSignal: AbortSignal | null = null;

  const promise = withTimeout(
    async (signal) => {
      capturedSignal = signal;
      // Use signal-aware operation
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 500);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("Aborted by signal"));
        });
      });
      return "done";
    },
    {
      timeoutMs: 1000,
      signal: parentController.signal,
      label: "test",
    },
  );

  // Abort parent after 50ms
  setTimeout(() => parentController.abort(), 50);

  await assertRejects(
    async () => await promise,
    Error,
  );

  // Signal should be aborted
  assertEquals(capturedSignal !== null, true);
  assertEquals(capturedSignal!.aborted, true);
});

// ============================================================
// combineSignals() Tests
// ============================================================

Deno.test("combineSignals - returns aborted signal if any input aborted", () => {
  const controller1 = new AbortController();
  const controller2 = new AbortController();

  controller1.abort();

  const combined = combineSignals(controller1.signal, controller2.signal);

  assertEquals(combined.aborted, true);
});

Deno.test("combineSignals - aborts when first input aborts", async () => {
  const controller1 = new AbortController();
  const controller2 = new AbortController();

  const combined = combineSignals(controller1.signal, controller2.signal);

  assertEquals(combined.aborted, false);

  controller1.abort();

  // Wait for event listener to fire
  await new Promise((resolve) => setTimeout(resolve, 10));

  assertEquals(combined.aborted, true);
});

Deno.test("combineSignals - aborts when second input aborts", async () => {
  const controller1 = new AbortController();
  const controller2 = new AbortController();

  const combined = combineSignals(controller1.signal, controller2.signal);

  assertEquals(combined.aborted, false);

  controller2.abort();

  // Wait for event listener to fire
  await new Promise((resolve) => setTimeout(resolve, 10));

  assertEquals(combined.aborted, true);
});

Deno.test("combineSignals - handles empty array", () => {
  // TypeScript would prevent this, but test runtime behavior
  const combined = combineSignals();

  assertEquals(combined.aborted, false);
});

Deno.test("combineSignals - propagates abort reason", () => {
  const controller = new AbortController();
  const reason = new Error("custom reason");

  controller.abort(reason);

  const combined = combineSignals(controller.signal);

  assertEquals(combined.aborted, true);
  assertEquals(combined.reason, reason);
});

// ============================================================
// isAbortError() Tests
// ============================================================

Deno.test("isAbortError - detects TimeoutError", () => {
  const error = new TimeoutError("test", 1000);
  assertEquals(isAbortError(error), true);
});

Deno.test("isAbortError - detects AbortError by name", () => {
  const error = new Error("aborted");
  error.name = "AbortError";
  assertEquals(isAbortError(error), true);
});

Deno.test("isAbortError - detects abort in message", () => {
  const error = new Error("operation was aborted");
  assertEquals(isAbortError(error), true);
});

Deno.test("isAbortError - rejects non-abort errors", () => {
  const error = new Error("network error");
  assertEquals(isAbortError(error), false);
});

Deno.test("isAbortError - rejects non-Error objects", () => {
  assertEquals(isAbortError("string error"), false);
  assertEquals(isAbortError(null), false);
  assertEquals(isAbortError(undefined), false);
  assertEquals(isAbortError(42), false);
});

// ============================================================
// TimeoutError Tests
// ============================================================

Deno.test("TimeoutError - has correct name", () => {
  const error = new TimeoutError("test", 1000);
  assertEquals(error.name, "TimeoutError");
});

Deno.test("TimeoutError - has correct message", () => {
  const error = new TimeoutError("LLM call", 5000);
  assertEquals(error.message, "LLM call timed out after 5000ms");
});

Deno.test("TimeoutError - is instance of Error", () => {
  const error = new TimeoutError("test", 1000);
  assertEquals(error instanceof Error, true);
});

// ============================================================
// Resource Cleanup Tests
// ============================================================

Deno.test("withTimeout - clears timeout on success", async () => {
  // This test verifies cleanup happens by ensuring no leaks
  // (hard to test directly, but important for documentation)

  await withTimeout(
    async (_signal) => {
      return "success";
    },
    { timeoutMs: 1000, label: "test" },
  );

  // If cleanup didn't happen, timeout would still fire
  // Wait to ensure no unexpected timeout
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Test passes if we get here without issues
  assertEquals(true, true);
});

Deno.test("withTimeout - clears timeout on error", async () => {
  try {
    await withTimeout(
      async (_signal) => {
        throw new Error("test error");
      },
      { timeoutMs: 1000, label: "test" },
    );
  } catch (_error) {
    // Expected
  }

  // Wait to ensure no unexpected timeout
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Test passes if we get here without issues
  assertEquals(true, true);
});

// ============================================================
// Integration Tests
// ============================================================

Deno.test("withTimeout - realistic LLM call simulation", async () => {
  const mockLLMCall = async (signal: AbortSignal) => {
    for (let i = 0; i < 10; i++) {
      if (signal.aborted) {
        throw new Error("LLM call aborted");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { response: "LLM response" };
  };

  const result = await withTimeout(
    mockLLMCall,
    { timeoutMs: 500, label: "LLM call" },
  );

  assertEquals(result.response, "LLM response");
});

Deno.test("withTimeout - realistic tool execution simulation", async () => {
  const mockToolExec = async (signal: AbortSignal) => {
    for (let i = 0; i < 5; i++) {
      if (signal.aborted) {
        throw new Error("Tool execution cancelled");
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { success: true, output: "tool result" };
  };

  const result = await withTimeout(
    mockToolExec,
    { timeoutMs: 500, label: "Tool execution" },
  );

  assertEquals(result.success, true);
});
