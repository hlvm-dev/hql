/**
 * Resource Limits - SSOT for size/count constraints
 *
 * Provides shared helpers to enforce size/count limits consistently.
 */

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

export function assertMaxCount(label: string, actual: number, limit: number): void {
  if (actual > limit) {
    throw new ResourceLimitError(label, actual, limit);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}
