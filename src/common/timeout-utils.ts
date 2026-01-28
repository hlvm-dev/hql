/**
 * Timeout Utilities - SSOT for timeout + AbortSignal operations
 *
 * Provides unified timeout handling with proper resource cleanup.
 * Combines timeout promises with AbortSignal for cancellable operations.
 *
 * Eliminates 3 duplicated timeout patterns:
 * - orchestrator.ts:553-573 (LLM timeout)
 * - orchestrator.ts:635-656 (tool timeout)
 * - safety.ts:420-424 (user input timeout)
 *
 * Features:
 * - Combines multiple AbortSignals (OR logic)
 * - Proper cleanup of timeout handles
 * - Distinguishes abort errors from other errors
 * - Type-safe signal propagation
 */

// ============================================================
// Types
// ============================================================

/**
 * Options for withTimeout()
 */
export interface TimeoutOptions {
  /** Timeout duration in milliseconds */
  timeoutMs: number;
  /** Optional parent AbortSignal to combine with timeout */
  signal?: AbortSignal;
  /** Label for error messages (e.g., "LLM call", "Tool execution") */
  label: string;
}

/**
 * Result from withTimeout() when timeout occurs
 */
export class TimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

// ============================================================
// Core Timeout Function
// ============================================================

/**
 * Execute operation with timeout and AbortSignal support
 *
 * Combines a timeout with optional parent AbortSignal. Operation receives
 * a combined signal that aborts when EITHER timeout expires OR parent aborts.
 *
 * Benefits:
 * - Proper cleanup: clearTimeout() called in all code paths
 * - Resource safety: Operation receives signal for early cancellation
 * - Composable: Can nest withTimeout() calls
 * - Type-safe: Generic return type preserved
 *
 * @param operation Async function that accepts AbortSignal
 * @param options Timeout configuration
 * @returns Operation result or throws TimeoutError
 *
 * @example
 * ```ts
 * // Simple timeout
 * const result = await withTimeout(
 *   async (signal) => {
 *     const response = await fetch(url, { signal });
 *     return response.json();
 *   },
 *   { timeoutMs: 5000, label: "API call" }
 * );
 *
 * // With parent signal
 * const controller = new AbortController();
 * const result = await withTimeout(
 *   async (signal) => longOperation(signal),
 *   { timeoutMs: 10000, signal: controller.signal, label: "Long op" }
 * );
 * ```
 */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: TimeoutOptions,
): Promise<T> {
  // Create timeout controller
  const timeoutController = new AbortController();

  // Combine with parent signal if provided
  const combinedSignal = options.signal
    ? combineSignals(timeoutController.signal, options.signal)
    : timeoutController.signal;

  // Create timeout promise that rejects
  let timeoutId: number | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      timeoutController.abort();
      reject(new TimeoutError(options.label, options.timeoutMs));
    }, options.timeoutMs);
  });

  // Race between operation and timeout
  try {
    const result = await Promise.race([
      operation(combinedSignal),
      timeoutPromise,
    ]);

    // Clear timeout on success
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    return result;
  } catch (error) {
    // Clear timeout on error
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    // If it's timeout error, throw it
    if (error instanceof TimeoutError) {
      throw error;
    }

    // Check if operation was aborted by parent signal
    if (options.signal?.aborted) {
      throw error; // Parent aborted - re-throw original error
    }

    // Check if timeout controller aborted
    if (timeoutController.signal.aborted) {
      throw new TimeoutError(options.label, options.timeoutMs);
    }

    // Other errors - re-throw as-is
    throw error;
  }
}

// ============================================================
// Signal Combination
// ============================================================

/**
 * Combine multiple AbortSignals with OR logic
 *
 * Creates a new signal that aborts when ANY of the input signals abort.
 * Useful for combining timeout signals with user cancellation signals.
 *
 * Implementation:
 * - Returns immediately if any signal already aborted
 * - Listens to all signals and aborts on first trigger
 * - Memory-safe: listeners are passive (no cleanup needed)
 *
 * @param signals AbortSignals to combine
 * @returns Combined signal that aborts when any input aborts
 *
 * @example
 * ```ts
 * const timeoutSignal = AbortSignal.timeout(5000);
 * const userSignal = userController.signal;
 * const combined = combineSignals(timeoutSignal, userSignal);
 *
 * // Operation aborts if EITHER timeout expires OR user cancels
 * await fetch(url, { signal: combined });
 * ```
 */
export function combineSignals(...signals: AbortSignal[]): AbortSignal {
  // Fast path: if any signal already aborted, return aborted signal
  for (const signal of signals) {
    if (signal.aborted) {
      const controller = new AbortController();
      controller.abort(signal.reason);
      return controller.signal;
    }
  }

  // Create combined controller
  const controller = new AbortController();

  // Listen to all signals
  for (const signal of signals) {
    signal.addEventListener("abort", () => {
      if (!controller.signal.aborted) {
        controller.abort(signal.reason);
      }
    });
  }

  return controller.signal;
}

// ============================================================
// Error Classification
// ============================================================

/**
 * Check if error is abort-related
 *
 * Handles multiple abort error patterns:
 * - Standard AbortError (DOMException name="AbortError")
 * - TimeoutError (our custom error)
 * - Generic errors with "abort" in message
 *
 * Used to distinguish cancellation from actual failures.
 *
 * @param error Error to check
 * @returns True if error indicates operation was aborted
 *
 * @example
 * ```ts
 * try {
 *   await fetch(url, { signal });
 * } catch (error) {
 *   if (isAbortError(error)) {
 *     console.log("Request was cancelled");
 *   } else {
 *     console.error("Request failed:", error);
 *   }
 * }
 * ```
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof TimeoutError) {
    return true;
  }

  if (error instanceof Error) {
    // Standard AbortError
    if (error.name === "AbortError") {
      return true;
    }

    // Some APIs throw generic errors with abort message
    if (error.message.toLowerCase().includes("abort")) {
      return true;
    }
  }

  return false;
}
