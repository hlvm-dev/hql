/**
 * Shared UI constants for repl-ink overlay components.
 */

/** Cursor blink interval in ms (macOS standard) */
export const CURSOR_BLINK_MS = 530;

/** Standard braille spinner sequence for REPL/TUI activity indicators. */
export const BRAILLE_SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;

/** Shared spinner frame interval (ms). */
export const SPINNER_FRAME_MS = 80;
