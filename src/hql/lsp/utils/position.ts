/**
 * LSP Position Utilities
 *
 * Handles conversion between LSP positions (0-indexed) and HQL positions (1-indexed).
 * This is the single source of truth for position handling to avoid off-by-one bugs.
 */

import type { Position, Range } from "npm:vscode-languageserver@9.0.1";
import type { TextDocument } from "npm:vscode-languageserver-textdocument@1.0.11";

/**
 * HQL uses 1-indexed positions (line 1, column 1 is first character)
 */
export interface HQLPosition {
  line: number; // 1-indexed
  column: number; // 1-indexed
}

/**
 * HQL range with start and end positions
 */
export interface HQLRange {
  start: HQLPosition;
  end: HQLPosition;
}

/**
 * Convert HQL position (1-indexed) to LSP position (0-indexed)
 */
export function toLSPPosition(pos: HQLPosition): Position {
  return {
    line: Math.max(0, pos.line - 1),
    character: Math.max(0, pos.column - 1),
  };
}

/**
 * Convert HQL range to LSP range
 */
export function toLSPRange(range: HQLRange): Range {
  return {
    start: toLSPPosition(range.start),
    end: toLSPPosition(range.end),
  };
}

/**
 * HQL identifier characters - used for word boundary detection
 */
const IDENT_CHAR_REGEX = /[a-zA-Z0-9_\-\?!]/;

/**
 * Get the word at a given position in a document
 * Returns the word and its range, or null if no word found
 */
export function getWordAtPosition(
  document: TextDocument,
  position: Position
): { word: string; range: Range } | null {
  const text = document.getText();
  const offset = document.offsetAt(position);

  // Check bounds
  if (offset < 0 || offset >= text.length) {
    return null;
  }

  // Find word boundaries
  let start = offset;
  let end = offset;

  // Expand left
  while (start > 0 && IDENT_CHAR_REGEX.test(text[start - 1])) {
    start--;
  }

  // Expand right
  while (end < text.length && IDENT_CHAR_REGEX.test(text[end])) {
    end++;
  }

  // No word found
  if (start === end) {
    return null;
  }

  const word = text.slice(start, end);

  return {
    word,
    range: {
      start: document.positionAt(start),
      end: document.positionAt(end),
    },
  };
}

/**
 * Convert LSP position (0-indexed) to HQL position (1-indexed)
 */
export function toHQLPosition(pos: Position): HQLPosition {
  return {
    line: pos.line + 1,
    column: pos.character + 1,
  };
}

/**
 * Convert LSP range to HQL range
 */
export function toHQLRange(range: Range): HQLRange {
  return {
    start: toHQLPosition(range.start),
    end: toHQLPosition(range.end),
  };
}
