/**
 * Shared String Utilities for REPL
 * Common string manipulation functions used across REPL modules
 */

/**
 * Escape special characters in a string for HQL/JSON string literals.
 * Handles: backslash, double quotes, newlines, carriage returns, tabs
 *
 * Optimized:
 * - Fast path: Return original string if no escaping needed (common case)
 * - Uses charCodeAt for O(1) character checks
 * - Single allocation when escaping is needed
 */
export function escapeString(s: string): string {
  // Fast path: check if any escaping is needed (charCode comparison is O(1))
  // Common case: most strings have no special characters
  let needsEscape = false;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    // Check for: \ (92), " (34), \n (10), \r (13), \t (9)
    if (code === 92 || code === 34 || code === 10 || code === 13 || code === 9) {
      needsEscape = true;
      break;
    }
  }

  // Fast path: no escaping needed, return original string
  if (!needsEscape) {
    return s;
  }

  // Slow path: build escaped string
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

// ============================================================
// Word Boundaries (Semantic Variants Explained)
// ============================================================
//
// There are THREE different word boundary semantics in the codebase,
// each intentionally designed for its use case:
//
// 1. WORD_BOUNDARY_CHARS (this file)
//    - For COMPLETION/SUGGESTION: All standard LISP tokenization boundaries
//    - Includes: whitespace, parens/brackets/braces, quotes, comma, semicolon
//    - Used by: completer.ts, providers.ts, suggester.ts
//
// 2. isWordBoundaryChar in Input.tsx (local function)
//    - For LISP STRUCTURAL EDITING: Ctrl+W word deletion
//    - Subset: only whitespace + delimiters (no quotes/comma/semicolon)
//    - Rationale: In LISP, strings and lists are atomic units for deletion
//    - Keeps quotes attached to strings, commas to data structures
//
// 3. calculateWord*Position in keyboard.ts
//    - For BASIC WORD NAVIGATION: Option+Arrow movement
//    - Minimal: only spaces as boundaries
//    - Rationale: Fast, simple navigation across tokens
//
// This is INTENTIONAL DIFFERENTIATION, not duplication.
// Each variant serves a specific UX purpose.
// ============================================================

/**
 * Characters that mark word boundaries for REPL completion.
 * This is the most comprehensive boundary definition - used for tokenization
 * and completion where we need exact symbol boundaries.
 */
export const WORD_BOUNDARY_CHARS: ReadonlySet<string> = new Set([
  " ", "\t", "\n", "\r",      // Whitespace
  "(", ")", "[", "]", "{", "}", // Delimiters
  '"', "'",                     // Quote boundaries
  ",", ";",                     // Separators
]);

/**
 * Check if character is a word boundary (for completion).
 * See module header for explanation of semantic variants.
 */
export function isWordBoundary(ch: string): boolean {
  return WORD_BOUNDARY_CHARS.has(ch);
}

// ============================================================
// Word Extraction (Single Source of Truth)
// ============================================================

/**
 * Get the word at cursor position for completion/suggestion.
 * Scans backwards from cursor to find the start of the current word.
 *
 * Used by:
 * - Traditional completer (repl/completer.ts)
 * - Ink completion providers (repl-ink/completion/providers.ts)
 * - Suggester for fish-style autosuggestions (repl/suggester.ts)
 *
 * @param text - Input text
 * @param cursorPosition - Cursor position
 * @returns The word and its start position
 */
export function getWordAtCursor(
  text: string,
  cursorPosition: number
): { word: string; start: number } {
  let start = cursorPosition;
  while (start > 0 && !isWordBoundary(text[start - 1])) {
    start--;
  }
  return {
    word: text.slice(start, cursorPosition),
    start,
  };
}
