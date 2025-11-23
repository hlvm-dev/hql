/**
 * Shared ANSI color codes for CLI components.
 */
export const ANSI_COLORS = {
  DARK_PURPLE: "\x1b[38;2;128;54;146m",
  PURPLE: "\x1b[35m",
  CYAN: "\x1b[36m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  ORANGE: "\x1b[38;2;255;165;0m",
  RED: "\x1b[31m",
  DIM_GRAY: "\x1b[90m",
  BOLD: "\x1b[1m",
  RESET: "\x1b[0m",
} as const;

export type AnsiColor = typeof ANSI_COLORS[keyof typeof ANSI_COLORS];
