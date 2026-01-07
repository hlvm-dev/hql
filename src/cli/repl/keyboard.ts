/**
 * HQL REPL Keyboard Handling - Pure Functions
 *
 * This module provides testable, pure functions for keyboard event handling.
 * Extracted from Input.tsx to enable comprehensive unit testing.
 *
 * Cross-platform support:
 * - macOS: Option+Arrow sends ESC+b/f (input='b'/'f', meta=true)
 * - Linux: Alt+Arrow sends ESC+b/f or modified arrows (meta=true)
 * - Windows: Ctrl+Arrow sends ctrl=true with arrow keys
 */

// ============================================================
// Types
// ============================================================

/** Ink's key object structure */
export interface KeyEvent {
  readonly upArrow: boolean;
  readonly downArrow: boolean;
  readonly leftArrow: boolean;
  readonly rightArrow: boolean;
  readonly pageDown: boolean;
  readonly pageUp: boolean;
  readonly return: boolean;
  readonly escape: boolean;
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly tab: boolean;
  readonly backspace: boolean;
  readonly delete: boolean;
  readonly meta: boolean;
}

/** Actions that can result from keyboard input */
export type KeyboardAction =
  | "move-word-back"
  | "move-word-forward"
  | "move-char-left"
  | "move-char-right"
  | "move-line-start"
  | "move-line-end"
  | "insert-newline"
  | "history-back"
  | "history-forward"
  | "delete-char-back"
  | "delete-char-forward"
  | "delete-word-back"
  | "delete-to-start"
  | "delete-to-end"
  | "submit"
  | "tab"
  | "shift-tab"
  | "escape"
  | "clear-screen"
  | null; // No special action, might be regular character input

// ============================================================
// Word Navigation - Pure Functions
// ============================================================

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

// ============================================================
// Keyboard Event Mapping - Cross-Platform Support
// ============================================================

/**
 * Map a keyboard event to an action.
 *
 * This function handles cross-platform keyboard shortcuts:
 * - macOS: Option+Arrow sends meta=true with input='b'/'f'
 * - Linux: Alt+Arrow similar to macOS
 * - Windows: Ctrl+Arrow sends ctrl=true with arrow keys
 * - All platforms: ESC sequences as fallback
 *
 * @param input - The character input (if any)
 * @param key - The key event object from Ink
 * @param escapePressed - Whether ESC was pressed in previous event
 * @returns The action to perform, or null for regular character input
 */
export function mapKeyToAction(
  input: string,
  key: KeyEvent,
  escapePressed: boolean = false
): KeyboardAction {
  // ========================================
  // Ctrl+key combinations (Windows/Linux style)
  // ========================================
  if (key.ctrl) {
    if (key.leftArrow) return "move-word-back";
    if (key.rightArrow) return "move-word-forward";
    if (input === "a") return "move-line-start";
    if (input === "e") return "move-line-end";
    if (input === "w") return "delete-word-back";
    if (input === "u") return "delete-to-start";
    if (input === "k") return "delete-to-end";
    if (input === "l") return "clear-screen";
    if (input === "c") return "escape"; // Ctrl+C often used to cancel
  }

  // ========================================
  // Meta+key combinations (macOS Option, Linux Alt)
  // ========================================
  if (key.meta) {
    // ESC+b/f style (macOS Option+Arrow, Linux Alt+Arrow)
    if (input === "b") return "move-word-back";
    if (input === "f") return "move-word-forward";
    // Modified arrow style (some terminals)
    if (key.leftArrow) return "move-word-back";
    if (key.rightArrow) return "move-word-forward";
    // Meta+Enter: insert newline
    if (key.return) return "insert-newline";
    // Meta+Backspace: delete word back
    if (key.backspace) return "delete-word-back";
  }

  // ========================================
  // ESC sequences (fallback for various terminals)
  // ========================================
  if (key.escape) {
    // ESC + arrow in same event
    if (key.leftArrow) return "move-word-back";
    if (key.rightArrow) return "move-word-forward";
    // ESC + b/f in same event
    if (input === "b") return "move-word-back";
    if (input === "f") return "move-word-forward";
    // ESC + Enter: insert newline
    if (key.return) return "insert-newline";
    // Pure ESC: handled separately (mode-dependent)
    return "escape";
  }

  // ========================================
  // Two-event ESC sequence (ESC pressed in previous event)
  // ========================================
  if (escapePressed) {
    if (key.leftArrow) return "move-word-back";
    if (key.rightArrow) return "move-word-forward";
    if (input === "b") return "move-word-back";
    if (input === "f") return "move-word-forward";
    if (key.return) return "insert-newline";
  }

  // ========================================
  // Navigation keys (no modifiers)
  // ========================================
  if (key.leftArrow) return "move-char-left";
  if (key.rightArrow) return "move-char-right";
  if (key.upArrow) return "history-back";
  if (key.downArrow) return "history-forward";

  // ========================================
  // Editing keys
  // ========================================
  if (key.backspace) return "delete-char-back";
  if (key.delete) return "delete-char-forward";
  if (key.return) return "submit";

  // ========================================
  // Tab
  // ========================================
  if (key.tab) {
    return key.shift ? "shift-tab" : "tab";
  }

  // No special action - regular character input
  return null;
}

/**
 * Check if a key event represents a word navigation shortcut.
 * Useful for quick checks without full action mapping.
 */
export function isWordNavigationKey(input: string, key: KeyEvent, escapePressed: boolean): boolean {
  const action = mapKeyToAction(input, key, escapePressed);
  return action === "move-word-back" || action === "move-word-forward";
}

/**
 * Create a mock KeyEvent for testing purposes.
 */
export function createMockKeyEvent(overrides: Partial<KeyEvent> = {}): KeyEvent {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    ...overrides,
  };
}
