/**
 * Text Editing Handler Library
 *
 * Pure functions for common text editing operations (Ctrl+A/E/W/U/K, word nav).
 * Can be called from any component's useInput handler.
 *
 * Design principles:
 * - Pure functions: (value, cursor, ...) => { value, cursor }
 * - No side effects: caller handles state updates
 * - Composable: use individual functions or the dispatcher
 */

import {
  calculateWordBackPosition,
  calculateWordForwardPosition,
} from "../../repl/keyboard.ts";

// ============================================================
// Types
// ============================================================

/** Result of a text editing operation */
export interface TextEditResult {
  value: string;
  cursor: number;
}

/** Key info from Ink's useInput */
export interface KeyInfo {
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  escape?: boolean;
  return?: boolean;
  tab?: boolean;
  backspace?: boolean;
  delete?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
}

// ============================================================
// Line Navigation
// ============================================================

/** Ctrl+A: Move cursor to start of line */
export function handleCtrlA(value: string, _cursor: number): TextEditResult {
  return { value, cursor: 0 };
}

/** Ctrl+E: Move cursor to end of line */
export function handleCtrlE(value: string, _cursor: number): TextEditResult {
  return { value, cursor: value.length };
}

// ============================================================
// Deletion Operations
// ============================================================

/** Ctrl+W: Delete word backward */

// ============================================================
// Paired Delimiter Support for Ctrl+W
// ============================================================

/**
 * Paired delimiters where Ctrl+W should preserve the outer pair.
 * Maps opening delimiter to closing delimiter.
 * Includes: "", '', "", '', ``, «»
 */
const PAIRED_DELIMITERS: Record<string, string> = {
  '"': '"',   // ASCII double quotes
  "'": "'",   // ASCII single quotes
  '`': '`',   // Backticks
  "\u201C": "\u201D",   // Smart double quotes (U+201C, U+201D): " and "
  "\u2018": "\u2019",   // Smart single quotes (U+2018, U+2019): ' and '
  "«": "»",   // Guillemets
};

/**
 * Find if cursor is inside a paired delimiter and return the positions.
 * Returns { openPos, closePos } or null if not inside delimiters.
 * 
 * For self-closing delimiters like "" or '', we need to count occurrences
 * to determine if we're inside (odd count before = inside).
 */
function findEnclosingDelimiters(
  value: string,
  cursor: number
): { openPos: number; closePos: number; openChar: string; closeChar: string } | null {
  // For each delimiter type, check if cursor is inside
  for (const [openChar, closeChar] of Object.entries(PAIRED_DELIMITERS)) {
    const isSelfClosing = openChar === closeChar;
    
    if (isSelfClosing) {
      // Self-closing delimiter (like "" or '')
      // Count occurrences before cursor
      let count = 0;
      let lastPos = -1;
      for (let i = 0; i < cursor; i++) {
        if (value[i] === openChar) {
          count++;
          lastPos = i;
        }
      }
      
      // If odd count, we're inside a string
      if (count % 2 === 1 && lastPos >= 0) {
        // Find closing delimiter after cursor
        const closePos = value.indexOf(closeChar, cursor);
        if (closePos >= 0) {
          return { openPos: lastPos, closePos, openChar, closeChar };
        }
      }
    } else {
      // Different open/close chars (like «»)
      // Find nearest open before cursor
      let openPos = -1;
      let depth = 0;
      for (let i = cursor - 1; i >= 0; i--) {
        if (value[i] === closeChar) depth++;
        else if (value[i] === openChar) {
          if (depth === 0) {
            openPos = i;
            break;
          }
          depth--;
        }
      }
      
      if (openPos >= 0) {
        // Find matching close after cursor
        depth = 0;
        for (let i = cursor; i < value.length; i++) {
          if (value[i] === openChar) depth++;
          else if (value[i] === closeChar) {
            if (depth === 0) {
              return { openPos, closePos: i, openChar, closeChar };
            }
            depth--;
          }
        }
      }
    }
  }
  
  return null;
}

/**
 * Delete word backward while preserving enclosing paired delimiters.
 * 
 * Example: (ask "hello|") → Ctrl+W → (ask "|")
 * 
 * Returns null if not inside delimiters (caller should use default behavior).
 */
function deleteWordPreservingDelimiters(value: string, cursor: number): TextEditResult | null {
  const delimiters = findEnclosingDelimiters(value, cursor);
  if (!delimiters) return null;
  
  const { openPos, closePos, openChar, closeChar } = delimiters;
  const contentStart = openPos + 1;
  const contentEnd = closePos;
  
  // Only apply if cursor is actually inside the delimiters (not on them)
  if (cursor <= contentStart || cursor > contentEnd) return null;
  
  // Get content inside delimiters
  const contentBefore = value.slice(contentStart, cursor);
  
  // Find where to delete to (within the delimited content)
  let deleteToPos = cursor;
  
  // Skip trailing whitespace
  while (deleteToPos > contentStart && contentBefore[deleteToPos - contentStart - 1] === ' ') {
    deleteToPos--;
  }
  
  // Delete word (stop at space or content start)
  while (deleteToPos > contentStart && contentBefore[deleteToPos - contentStart - 1] !== ' ') {
    deleteToPos--;
  }
  
  // If cursor was right after opening delimiter and nothing to delete, 
  // return null to allow default behavior
  if (deleteToPos === cursor) return null;
  
  // Build new value: everything before delete point + everything from cursor onward
  const newValue = value.slice(0, deleteToPos) + value.slice(cursor);
  
  return { value: newValue, cursor: deleteToPos };
}

export function handleCtrlW(value: string, cursor: number): TextEditResult {
  if (cursor <= 0) return { value, cursor };

  // Check if cursor is inside paired delimiters
  // If so, delete content inside but preserve the delimiters
  const delimiterResult = deleteWordPreservingDelimiters(value, cursor);
  if (delimiterResult) {
    return delimiterResult;
  }

  // Default behavior: delete word backward
  const newCursor = calculateWordBackPosition(value, cursor);
  const newValue = value.slice(0, newCursor) + value.slice(cursor);
  return { value: newValue, cursor: newCursor };
}

/** Ctrl+U: Delete from cursor to start of line */
export function handleCtrlU(value: string, cursor: number): TextEditResult {
  return { value: value.slice(cursor), cursor: 0 };
}

/** Ctrl+K: Delete from cursor to end of line */
export function handleCtrlK(value: string, cursor: number): TextEditResult {
  return { value: value.slice(0, cursor), cursor };
}

/** Backspace: Delete character before cursor */
export function handleBackspace(value: string, cursor: number): TextEditResult {
  if (cursor <= 0) return { value, cursor };
  return {
    value: value.slice(0, cursor - 1) + value.slice(cursor),
    cursor: cursor - 1,
  };
}

// ============================================================
// Word Navigation
// ============================================================

/** Alt+B / Ctrl+Left: Move word backward */
export function handleWordBack(value: string, cursor: number): TextEditResult {
  return { value, cursor: calculateWordBackPosition(value, cursor) };
}

/** Alt+F / Ctrl+Right: Move word forward */
export function handleWordForward(value: string, cursor: number): TextEditResult {
  return { value, cursor: calculateWordForwardPosition(value, cursor) };
}

// ============================================================
// Character Navigation
// ============================================================

/** Left Arrow: Move cursor left */
export function handleLeftArrow(value: string, cursor: number): TextEditResult {
  return { value, cursor: Math.max(0, cursor - 1) };
}

/** Right Arrow: Move cursor right */
export function handleRightArrow(value: string, cursor: number): TextEditResult {
  return { value, cursor: Math.min(value.length, cursor + 1) };
}

// ============================================================
// Character Input
// ============================================================

/** Insert character(s) at cursor position */
export function insertChar(value: string, cursor: number, char: string): TextEditResult {
  return {
    value: value.slice(0, cursor) + char + value.slice(cursor),
    cursor: cursor + char.length,
  };
}

// ============================================================
// Dispatcher Function
// ============================================================

/**
 * Handle common text editing keyboard shortcuts.
 * Returns null if the key combination is not handled.
 *
 * @example
 * useInput((input, key) => {
 *   const result = handleTextEditingKey(input, key, value, cursor);
 *   if (result) {
 *     setValue(result.value);
 *     setCursor(result.cursor);
 *     return;
 *   }
 *   // ... component-specific handling
 * });
 */
export function handleTextEditingKey(
  input: string,
  key: KeyInfo,
  value: string,
  cursor: number
): TextEditResult | null {
  // Backspace/Delete - handle first (highest priority)
  if (key.backspace || key.delete) {
    return handleBackspace(value, cursor);
  }

  // Ctrl shortcuts
  if (key.ctrl) {
    switch (input) {
      case "a":
        return handleCtrlA(value, cursor);
      case "e":
        return handleCtrlE(value, cursor);
      case "w":
        return handleCtrlW(value, cursor);
      case "u":
        return handleCtrlU(value, cursor);
      case "k":
        return handleCtrlK(value, cursor);
    }
    // Ctrl+Arrow for word navigation
    if (key.leftArrow) return handleWordBack(value, cursor);
    if (key.rightArrow) return handleWordForward(value, cursor);
  }

  // Meta (Alt/Option on macOS) shortcuts - word navigation
  if (key.meta) {
    if (input === "b") return handleWordBack(value, cursor);
    if (input === "f") return handleWordForward(value, cursor);
    if (key.leftArrow) return handleWordBack(value, cursor);
    if (key.rightArrow) return handleWordForward(value, cursor);
  }

  // Basic arrow navigation (no modifiers)
  if (!key.ctrl && !key.meta) {
    if (key.leftArrow) return handleLeftArrow(value, cursor);
    if (key.rightArrow) return handleRightArrow(value, cursor);
  }

  // Character input - printable characters only
  if (input && !key.ctrl && !key.meta && input.length === 1) {
    const charCode = input.charCodeAt(0);
    // Skip control characters (codes 0-31) except tab is handled elsewhere
    if (charCode > 31) {
      return insertChar(value, cursor, input);
    }
  }

  return null;
}
