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
 *     const response = await http.get(url, { signal });
 *     return response;
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
  const { timeoutMs, signal: parentSignal, label } = options;

  // Create timeout controller
  const timeoutController = new AbortController();

  // Combine with parent signal if provided
  const combinedSignal = parentSignal
    ? combineSignals(timeoutController.signal, parentSignal)
    : timeoutController.signal;

  // Create timeout promise that rejects
  let timeoutId: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timeoutController.abort();
      reject(new TimeoutError(label, timeoutMs));
    }, timeoutMs);
  });

  // Race between operation and timeout
  try {
    return await Promise.race([
      operation(combinedSignal),
      timeoutPromise,
    ]);
  } catch (error) {
    // If it's timeout error, throw it
    if (error instanceof TimeoutError) {
      throw error;
    }

    // Check if operation was aborted by parent signal
    if (parentSignal?.aborted) {
      throw error; // Parent aborted - re-throw original error
    }

    // Check if timeout controller aborted
    if (timeoutController.signal.aborted) {
      throw new TimeoutError(label, timeoutMs);
    }

    // Other errors - re-throw as-is
    throw error;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
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
 * - Removes listeners after abort to avoid stale references
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
 * await http.get(url, { signal: combined });
 * ```
 */
export function combineSignals(...signals: AbortSignal[]): AbortSignal {
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

// ============================================================
// Error Helpers
// ============================================================

/** Create an AbortError without throwing. */
export function createAbortError(reason?: unknown): Error {
  const message = typeof reason === "string" && reason.length > 0
    ? reason
    : "Aborted";
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

/**
 * Throw AbortError if signal is already aborted.
 *
 * Useful for long-running loops to cooperatively cancel work.
 */
export function throwIfAborted(
  signal?: AbortSignal,
  message = "Operation aborted",
): void {
  if (signal?.aborted) throw createAbortError(message);
}
