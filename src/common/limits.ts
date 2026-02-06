/**
 * Resource Limits - SSOT for size/count constraints
 *
 * Provides shared helpers to enforce size/count limits consistently.
 */

// ============================================================
// Shared Constants
// ============================================================

/**
 * Default LRU cache size for macro/import caches.
 *
 * Chosen to be safely above typical project sizes while
 * preventing unbounded memory growth.
 */
export const DEFAULT_LRU_CACHE_SIZE = 5000;

/**
 * Maximum sequence length when realizing lazy seqs.
 * See InterpreterConfig maxSeqLength default.
 */
export const MAX_SEQ_LENGTH = 10000;

/**
 * Maximum iterations for macro expansion to avoid infinite loops.
 */
export const MAX_EXPANSION_ITERATIONS = 1000;

// ============================================================
// Errors
// ============================================================

export class ResourceLimitError extends Error {
  readonly limit: number;
  readonly actual: number;

  constructor(label: string, actual: number, limit: number) {
    super(`${label} exceeds limit (${actual} > ${limit})`);
    this.name = "ResourceLimitError";
    this.limit = limit;
    this.actual = actual;
  }
}

// ============================================================
// Helpers
// ============================================================

export function assertMaxBytes(label: string, actual: number, limit: number): void {
  if (actual > limit) {
    throw new ResourceLimitError(label, actual, limit);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  if (gb < 1024) return `${gb.toFixed(2)} GB`;
  const tb = gb / 1024;
  return `${tb.toFixed(2)} TB`;
}
