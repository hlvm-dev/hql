/**
 * HQL REPL Paredit - Structural Editing Operations
 *
 * Implements classic paredit operations for s-expression manipulation:
 * - Slurp: Pull adjacent sexp into current list
 * - Barf: Push edge sexp out of current list
 * - Wrap: Surround sexp with delimiters
 * - Splice: Remove enclosing delimiters
 * - Raise: Replace parent with current sexp
 * - Kill: Delete s-expression
 * - Transpose: Swap adjacent s-expressions
 *
 * All functions are pure and return { newValue, newCursor } or null if operation not applicable.
 */

import {
  findMatchingParen,
  forwardSexp,
  backwardSexp,
  backwardUpSexp,
  OPEN_TO_CLOSE,
} from "./syntax.ts";

// ============================================================
// Types
// ============================================================

export interface PareditResult {
  newValue: string;
  newCursor: number;
}

interface SexpBounds {
  start: number;
  end: number;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Find the opening paren of the list containing the cursor position.
 * Walks backward through nesting levels to find the enclosing open delimiter.
 */
function findEnclosingOpen(input: string, pos: number): number | null {
  // Use backwardUpSexp which finds the opening paren of enclosing list
  const openPos = backwardUpSexp(input, pos);
  // backwardUpSexp returns 0 if at top level or not in a list
  if (openPos === 0 && pos > 0) {
    // Check if there's actually an open paren at position 0
    if (input[0] in OPEN_TO_CLOSE) {
      return 0;
    }
    return null;
  }
  if (openPos < pos && input[openPos] in OPEN_TO_CLOSE) {
    return openPos;
  }
  return null;
}

/**
 * Find the closing paren of the list containing the cursor position.
 * First finds the opening paren, then finds its matching close.
 */
function findEnclosingClose(input: string, pos: number): number | null {
  const openPos = findEnclosingOpen(input, pos);
  if (openPos === null) return null;
  return findMatchingParen(input, openPos);
}

/**
 * Get the boundaries of the sexp at or starting from the cursor position.
 * Returns { start, end } where end is exclusive (position after last char).
 */
function getSexpBoundaries(input: string, pos: number): SexpBounds | null {
  if (pos >= input.length) return null;

  // Skip whitespace to find start of sexp
  let start = pos;
  while (start < input.length && /\s/.test(input[start])) start++;
  if (start >= input.length) return null;

  // Use forwardSexp to find the end
  const end = forwardSexp(input, start);
  if (end === start) return null;

  return { start, end };
}

/**
 * Get the boundaries of the sexp before the cursor position.
 * Returns { start, end } of the previous sexp.
 */
function getPrevSexpBoundaries(input: string, pos: number): SexpBounds | null {
  if (pos <= 0) return null;

  // backwardSexp gives us the start of the previous sexp
  const start = backwardSexp(input, pos);
  if (start >= pos) return null;

  // forwardSexp from start gives us the end
  const end = forwardSexp(input, start);

  return { start, end };
}

/**
 * Get boundaries of the enclosing list (parent sexp).
 */
function getEnclosingSexp(input: string, pos: number): SexpBounds | null {
  const openPos = findEnclosingOpen(input, pos);
  if (openPos === null) return null;

  const closePos = findMatchingParen(input, openPos);
  if (closePos === null) return null;

  return { start: openPos, end: closePos + 1 };
}

/**
 * Skip whitespace forward from position.
 */
function skipWhitespaceForward(input: string, pos: number): number {
  while (pos < input.length && /\s/.test(input[pos])) pos++;
  return pos;
}

/**
 * Skip whitespace backward from position.
 */
function skipWhitespaceBackward(input: string, pos: number): number {
  while (pos > 0 && /\s/.test(input[pos - 1])) pos--;
  return pos;
}

// ============================================================
// Slurp Operations
// ============================================================

/**
 * Slurp Forward: Pull the next sexp into the current list.
 *
 * Example: (foo |bar) baz → (foo |bar baz)
 *
 * Algorithm:
 * 1. Find enclosing close paren
 * 2. Find next sexp after close paren
 * 3. Move close paren to after next sexp
 */
export function slurpForward(input: string, pos: number): PareditResult | null {
  // Find the closing paren of the enclosing list
  const closePos = findEnclosingClose(input, pos);
  if (closePos === null) return null;

  // Find next sexp after the close paren
  const afterClose = skipWhitespaceForward(input, closePos + 1);
  if (afterClose >= input.length) return null;

  const nextSexp = getSexpBoundaries(input, afterClose);
  if (nextSexp === null) return null;

  // Get the closing delimiter character
  const closeChar = input[closePos];

  // Build new string:
  // - Everything before close paren
  // - Content between close paren and next sexp (whitespace)
  // - The next sexp
  // - The close paren
  // - Everything after next sexp
  const before = input.slice(0, closePos);
  const between = input.slice(closePos + 1, nextSexp.start);
  const sexpContent = input.slice(nextSexp.start, nextSexp.end);
  const after = input.slice(nextSexp.end);

  // Ensure proper spacing: at least one space before the slurped sexp
  const spacing = between.trim() === "" ? " " : between;

  const newValue = before + spacing + sexpContent + closeChar + after;

  // Cursor stays at same logical position
  return { newValue, newCursor: pos };
}

/**
 * Slurp Backward: Pull the previous sexp into the current list.
 *
 * Example: foo (bar| baz) → (foo bar| baz)
 *
 * Algorithm:
 * 1. Find enclosing open paren
 * 2. Find previous sexp before open paren
 * 3. Move open paren to before previous sexp
 */
export function slurpBackward(input: string, pos: number): PareditResult | null {
  // Find the opening paren of the enclosing list
  const openPos = findEnclosingOpen(input, pos);
  if (openPos === null || openPos === 0) return null;

  // Find previous sexp before the open paren
  const beforeOpen = skipWhitespaceBackward(input, openPos);
  if (beforeOpen <= 0) return null;

  const prevSexp = getPrevSexpBoundaries(input, beforeOpen);
  if (prevSexp === null) return null;

  // Get the opening delimiter character
  const openChar = input[openPos];

  // Build new string:
  // - Everything before prev sexp
  // - The open paren
  // - The prev sexp
  // - Content between prev sexp and open paren (becomes spacing)
  // - Everything after open paren
  const before = input.slice(0, prevSexp.start);
  const sexpContent = input.slice(prevSexp.start, prevSexp.end);
  const between = input.slice(prevSexp.end, openPos);
  const after = input.slice(openPos + 1);

  // Ensure proper spacing
  const spacing = between.trim() === "" ? " " : between;

  const newValue = before + openChar + sexpContent + spacing + after;

  // Adjust cursor: moved by the relocation
  const cursorDelta = prevSexp.start - openPos + 1;
  return { newValue, newCursor: pos + cursorDelta };
}

// ============================================================
// Barf Operations
// ============================================================

/**
 * Barf Forward: Push the last sexp out of the current list.
 *
 * Example: (foo bar| baz) → (foo bar|) baz
 *
 * Algorithm:
 * 1. Find enclosing close paren
 * 2. Find last sexp inside the list (just before close)
 * 3. Move close paren to before last sexp
 */
export function barfForward(input: string, pos: number): PareditResult | null {
  // Find enclosing parens
  const closePos = findEnclosingClose(input, pos);
  if (closePos === null) return null;

  const openPos = findEnclosingOpen(input, pos);
  if (openPos === null) return null;

  // Find the last sexp inside the list
  const beforeClose = skipWhitespaceBackward(input, closePos);
  const lastSexp = getPrevSexpBoundaries(input, beforeClose);

  // Can't barf if there's only one element or cursor is past the last sexp
  if (lastSexp === null || lastSexp.start <= openPos + 1) return null;

  // Don't barf the sexp under cursor
  if (pos >= lastSexp.start && pos <= lastSexp.end) {
    // Find the sexp before this one
    const prevOfLast = getPrevSexpBoundaries(input, lastSexp.start);
    if (prevOfLast === null || prevOfLast.start <= openPos + 1) return null;
  }

  const closeChar = input[closePos];

  // Build new string:
  // - Everything before last sexp
  // - Close paren
  // - Space
  // - The last sexp (now outside)
  // - Everything after original close
  const before = input.slice(0, lastSexp.start);
  const sexpContent = input.slice(lastSexp.start, lastSexp.end);
  const betweenSexpAndClose = input.slice(lastSexp.end, closePos);
  const after = input.slice(closePos + 1);

  // Trim trailing whitespace before close, add space after close
  const trimmedBefore = before.trimEnd();
  const newValue = trimmedBefore + closeChar + " " + sexpContent + after;

  // Adjust cursor if it was after the barfed sexp
  let newCursor = pos;
  if (pos > lastSexp.start) {
    // Cursor is in or after the barfed sexp, needs adjustment
    const shift = before.length - trimmedBefore.length - betweenSexpAndClose.length;
    newCursor = Math.min(pos + shift, trimmedBefore.length);
  }

  return { newValue, newCursor };
}

/**
 * Barf Backward: Push the first sexp out of the current list.
 *
 * Example: (foo bar| baz) → foo (bar| baz)
 *
 * Algorithm:
 * 1. Find enclosing open paren
 * 2. Find first sexp inside the list (just after open)
 * 3. Move open paren to after first sexp
 */
export function barfBackward(input: string, pos: number): PareditResult | null {
  // Find enclosing parens
  const openPos = findEnclosingOpen(input, pos);
  if (openPos === null) return null;

  const closePos = findEnclosingClose(input, pos);
  if (closePos === null) return null;

  // Find the first sexp inside the list
  const afterOpen = skipWhitespaceForward(input, openPos + 1);
  const firstSexp = getSexpBoundaries(input, afterOpen);

  // Can't barf if there's only one element
  if (firstSexp === null || firstSexp.end >= closePos) return null;

  // Don't barf the sexp under cursor
  if (pos >= firstSexp.start && pos <= firstSexp.end) return null;

  const openChar = input[openPos];

  // Build new string:
  // - Everything before original open
  // - The first sexp (now outside)
  // - Space
  // - Open paren
  // - Everything after first sexp until close
  // - Close paren and after
  const before = input.slice(0, openPos);
  const sexpContent = input.slice(firstSexp.start, firstSexp.end);
  const afterFirstSexp = input.slice(firstSexp.end, closePos);
  const closeAndAfter = input.slice(closePos);

  // Trim leading whitespace after open, add space before new open
  const trimmedAfterFirst = afterFirstSexp.trimStart();
  const newValue = before + sexpContent + " " + openChar + trimmedAfterFirst + closeAndAfter;

  // Adjust cursor position
  const shift = sexpContent.length + 1 - (firstSexp.start - openPos);
  return { newValue, newCursor: pos + shift };
}

// ============================================================
// Wrap/Splice/Raise Operations
// ============================================================

/**
 * Wrap: Surround the sexp at cursor with parentheses.
 *
 * Example: |foo bar → (|foo) bar
 *
 * Algorithm:
 * 1. Find sexp boundaries at cursor
 * 2. Insert ( before and ) after
 */
export function wrapSexp(input: string, pos: number, openChar: string = "("): PareditResult | null {
  const closeChar = OPEN_TO_CLOSE[openChar];
  if (!closeChar) return null;

  // Find sexp at cursor
  const sexp = getSexpBoundaries(input, pos);
  if (sexp === null) return null;

  // Build new string with parens around sexp
  const before = input.slice(0, sexp.start);
  const sexpContent = input.slice(sexp.start, sexp.end);
  const after = input.slice(sexp.end);

  const newValue = before + openChar + sexpContent + closeChar + after;

  // Position cursor just after opening paren
  return { newValue, newCursor: sexp.start + 1 };
}

/**
 * Splice: Remove the enclosing parentheses, keeping contents.
 *
 * Example: (foo (|bar baz)) → (foo |bar baz)
 *
 * Algorithm:
 * 1. Find enclosing parens
 * 2. Remove both parens, keep contents
 */
export function spliceSexp(input: string, pos: number): PareditResult | null {
  // Find enclosing parens
  const openPos = findEnclosingOpen(input, pos);
  if (openPos === null) return null;

  const closePos = findMatchingParen(input, openPos);
  if (closePos === null) return null;

  // Build new string without the parens
  const before = input.slice(0, openPos);
  const contents = input.slice(openPos + 1, closePos);
  const after = input.slice(closePos + 1);

  const newValue = before + contents + after;

  // Adjust cursor (shifted by removal of open paren)
  return { newValue, newCursor: pos - 1 };
}

/**
 * Raise: Replace the parent sexp with the sexp at cursor.
 *
 * Example: (foo (|bar) baz) → (|bar)
 *
 * Algorithm:
 * 1. Find sexp at cursor
 * 2. Find parent sexp
 * 3. Replace parent with current sexp
 */
export function raiseSexp(input: string, pos: number): PareditResult | null {
  // Find the sexp at/containing cursor
  // First check if we're inside a list - if so, find the current element
  let sexp: SexpBounds | null = null;

  // Try to find the sexp the cursor is in or on
  const prevSexp = getPrevSexpBoundaries(input, pos);
  const nextSexp = getSexpBoundaries(input, pos);

  // Prefer the sexp we're inside of
  if (prevSexp && pos <= prevSexp.end) {
    sexp = prevSexp;
  } else if (nextSexp && pos >= nextSexp.start) {
    sexp = nextSexp;
  } else if (nextSexp) {
    sexp = nextSexp;
  }

  if (sexp === null) return null;

  // Find the parent (enclosing) sexp
  const parent = getEnclosingSexp(input, pos);
  if (parent === null) return null;

  // The sexp should be inside the parent
  if (sexp.start < parent.start || sexp.end > parent.end) return null;

  // Build new string: replace parent with sexp content
  const before = input.slice(0, parent.start);
  const sexpContent = input.slice(sexp.start, sexp.end);
  const after = input.slice(parent.end);

  const newValue = before + sexpContent + after;

  // Position cursor at start of raised sexp
  return { newValue, newCursor: parent.start };
}

// ============================================================
// Kill/Transpose Operations
// ============================================================

/**
 * Kill Sexp: Delete the sexp at or after cursor.
 *
 * Example: (foo |bar baz) → (foo | baz)
 *
 * Algorithm:
 * 1. Find sexp boundaries at cursor
 * 2. Delete it
 */
export function killSexp(input: string, pos: number): PareditResult | null {
  // Find sexp at cursor
  const sexp = getSexpBoundaries(input, pos);
  if (sexp === null) return null;

  // Build new string without the sexp
  const before = input.slice(0, sexp.start);
  const after = input.slice(sexp.end);

  // Clean up whitespace: if there's space both before and after, keep just one
  let newValue: string;
  if (before.endsWith(" ") && after.startsWith(" ")) {
    newValue = before + after.trimStart();
  } else {
    newValue = before + after;
  }

  return { newValue, newCursor: sexp.start };
}

/**
 * Transpose Sexps: Swap the sexp at cursor with the previous one.
 *
 * Example: (foo |bar baz) → (bar |foo baz)
 *
 * Algorithm:
 * 1. Find sexp at cursor
 * 2. Find previous sexp
 * 3. Swap them
 */
export function transposeSexp(input: string, pos: number): PareditResult | null {
  // Find sexp at/after cursor
  const currentSexp = getSexpBoundaries(input, pos);
  if (currentSexp === null) return null;

  // Find previous sexp
  const prevSexp = getPrevSexpBoundaries(input, currentSexp.start);
  if (prevSexp === null) return null;

  // Get contents
  const prevContent = input.slice(prevSexp.start, prevSexp.end);
  const currentContent = input.slice(currentSexp.start, currentSexp.end);
  const between = input.slice(prevSexp.end, currentSexp.start);

  // Build new string with swapped sexps
  const before = input.slice(0, prevSexp.start);
  const after = input.slice(currentSexp.end);

  const newValue = before + currentContent + between + prevContent + after;

  // Position cursor after the transposed sexp (now where prev was)
  const newCursor = prevSexp.start + currentContent.length + between.length + prevContent.length;

  return { newValue, newCursor };
}
