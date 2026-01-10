/**
 * HQL REPL Completer Utilities
 *
 * Provides word extraction for completion and suggestion systems.
 */

import { isWordBoundary } from "./string-utils.ts";

// Re-export shared types and functions from known-identifiers.ts
export {
  KEYWORD_SET,
  OPERATOR_SET,
  MACRO_SET,
  classifyIdentifier,
} from "../../common/known-identifiers.ts";

// ============================================================
// Types
// ============================================================

export type CompletionType =
  | "keyword"
  | "operator"
  | "macro"
  | "function"
  | "variable";

export interface CompletionItem {
  /** The completion text */
  readonly text: string;
  /** Type of identifier */
  readonly type: CompletionType;
}

// ============================================================
// Word Extraction
// ============================================================

/**
 * Get the word at cursor position for completion.
 *
 * @param line - Current input line
 * @param cursorPos - Cursor position
 * @returns The word and its start position
 */
export function getWordAtCursor(
  line: string,
  cursorPos: number
): { word: string; start: number } {
  // Find start of word (scan backwards)
  let start = cursorPos;
  while (start > 0 && !isWordBoundary(line[start - 1])) {
    start--;
  }

  return {
    word: line.slice(start, cursorPos),
    start,
  };
}
