/**
 * Shared String Utilities for REPL
 * Common string manipulation functions used across REPL modules
 */

/**
 * Escape special characters in a string for HQL/JSON string literals.
 * Handles: backslash, double quotes, newlines, carriage returns, tabs
 *
 * Optimized: Single-pass O(n) with array buffer for efficient string building
 */
export function escapeString(s: string): string {
  const parts: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    switch (ch) {
      case "\\": parts.push("\\\\"); break;
      case '"':  parts.push('\\"'); break;
      case "\n": parts.push("\\n"); break;
      case "\r": parts.push("\\r"); break;
      case "\t": parts.push("\\t"); break;
      default:   parts.push(ch);
    }
  }
  return parts.join("");
}

/**
 * Type-safe access to globalThis as a Record.
 * Centralizes the common type cast pattern used for dynamic property access.
 */
export function getGlobalRecord(): Record<string, unknown> {
  return globalThis as unknown as Record<string, unknown>;
}
