/**
 * Generic retry with configurable exponential backoff.
 */

export interface RetryOptions {
  maxAttempts: number;
  /** Initial delay in ms (default: 1000) */
  initialDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffFactor?: number;
  /** Maximum delay cap in ms (default: 30000) */
  maxDelayMs?: number;
  /** Return false to stop retrying early */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Called before each retry sleep */
  onRetry?: (error: unknown, attempt: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const {
    maxAttempts,
    initialDelayMs = 1000,
    backoffFactor = 2,
    maxDelayMs = 30_000,
    shouldRetry,
    onRetry,
  } = opts;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      if (shouldRetry && !shouldRetry(error, attempt)) break;
      onRetry?.(error, attempt);
      const delay = Math.min(
        initialDelayMs * backoffFactor ** (attempt - 1),
        maxDelayMs,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
