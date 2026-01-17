/**
 * LSP Position Utilities
 *
 * Handles conversion between LSP positions (0-indexed) and HQL positions (1-indexed).
 * This is the single source of truth for position handling to avoid off-by-one bugs.
 *
 * This module consolidates position handling that was previously scattered between:
 * - src/hql/transpiler/utils/source_location_utils.ts (AST → SourceLocation)
 * - This file (HQL positions → LSP positions)
 *
 * Use the bridging functions (nodeToLSPRange, etc.) when you need to go directly
 * from AST nodes to LSP positions.
 */

import type { Position, Range } from "npm:vscode-languageserver@9.0.1";
import type { TextDocument } from "npm:vscode-languageserver-textdocument@1.0.11";
import type { HQLNode } from "../../transpiler/type/hql_ast.ts";
import { resolveSourceLocation } from "../../transpiler/utils/source_location_utils.ts";

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

// =============================================================================
// BRIDGING FUNCTIONS - AST Node to LSP Position
// =============================================================================
// These functions consolidate the pattern of:
// 1. Extracting source location from an AST node (resolveSourceLocation)
// 2. Converting that to LSP positions (toLSPPosition/toLSPRange)

/**
 * Convert an HQL AST node directly to an LSP Position.
 * Returns null if the node has no source location metadata.
 *
 * @param node - An HQL AST node that may have _meta, meta, or location fields
 * @returns LSP Position or null if no location available
 *
 * @example
 * const pos = nodeToLSPPosition(symbolNode);
 * if (pos) {
 *   // Use the LSP position
 * }
 */
export function nodeToLSPPosition(node: HQLNode): Position | null {
  const loc = resolveSourceLocation(node);
  if (!loc || loc.line === undefined || loc.column === undefined) return null;

  return toLSPPosition({
    line: loc.line,
    column: loc.column,
  });
}

/**
 * Convert an HQL AST node directly to an LSP Range.
 * Uses the node's start position for both start and end if no end position is available.
 *
 * @param node - An HQL AST node that may have source location metadata
 * @returns LSP Range or null if no location available
 *
 * @example
 * const range = nodeToLSPRange(listNode);
 * if (range) {
 *   diagnostics.push({ range, message: "Error here" });
 * }
 */
export function nodeToLSPRange(node: HQLNode): Range | null {
  const loc = resolveSourceLocation(node);
  if (!loc || loc.line === undefined || loc.column === undefined) return null;

  const start: HQLPosition = { line: loc.line, column: loc.column };

  // Use end position if available, otherwise use start position
  const end: HQLPosition = loc.endLine !== undefined && loc.endColumn !== undefined
    ? { line: loc.endLine, column: loc.endColumn }
    : start;

  return toLSPRange({ start, end });
}

/**
 * Convert an HQL AST node to an LSP Range with a specified length.
 * Useful when you know the symbol name length but the AST doesn't have end position.
 *
 * @param node - An HQL AST node
 * @param length - The length of the range (number of characters)
 * @returns LSP Range or null if no location available
 *
 * @example
 * const range = nodeToLSPRangeWithLength(symbolNode, symbolNode.name.length);
 */
export function nodeToLSPRangeWithLength(node: HQLNode, length: number): Range | null {
  const loc = resolveSourceLocation(node);
  if (!loc || loc.line === undefined || loc.column === undefined) return null;

  const start: HQLPosition = { line: loc.line, column: loc.column };
  const end: HQLPosition = { line: loc.line, column: loc.column + length };

  return toLSPRange({ start, end });
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
