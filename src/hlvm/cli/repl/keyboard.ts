/**
 * HLVM REPL Keyboard Handling - Word Navigation Functions
 *
 * NOTE: These functions use MINIMAL word boundaries (spaces only).
 * This is an intentional design choice for fast, simple navigation.
 * See string-utils.ts header for explanation of word boundary semantic variants.
 */

/**
 * Calculate new cursor position after moving one word backward.
 *
 * Algorithm:
 * 1. Skip any whitespace before cursor
 * 2. Move to start of current word
 *
 * @param value - Current input text
 * @param cursorPos - Current cursor position
 * @returns New cursor position
 */
export function calculateWordBackPosition(value: string, cursorPos: number): number {
  let pos = cursorPos;
  // Skip whitespace
  while (pos > 0 && value[pos - 1] === " ") pos--;
  // Move to start of word
  while (pos > 0 && value[pos - 1] !== " ") pos--;
  return pos;
}

/**
 * Calculate new cursor position after moving one word forward.
 *
 * Algorithm:
 * 1. Skip current word (non-space characters)
 * 2. Skip whitespace after word
 *
 * @param value - Current input text
 * @param cursorPos - Current cursor position
 * @returns New cursor position
 */
export function calculateWordForwardPosition(value: string, cursorPos: number): number {
  let pos = cursorPos;
  // Skip current word
  while (pos < value.length && value[pos] !== " ") pos++;
  // Skip whitespace
  while (pos < value.length && value[pos] === " ") pos++;
  return pos;
}
