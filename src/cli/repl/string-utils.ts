/**
 * Shared String Utilities for REPL
 * Common string manipulation functions used across REPL modules
 */

/**
 * Escape special characters in a string for HQL/JSON string literals.
 * Handles: backslash, double quotes, newlines, carriage returns, tabs
 */
export function escapeString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Type-safe access to globalThis as a Record.
 * Centralizes the common type cast pattern used for dynamic property access.
 */
export function getGlobalRecord(): Record<string, unknown> {
  return globalThis as unknown as Record<string, unknown>;
}
