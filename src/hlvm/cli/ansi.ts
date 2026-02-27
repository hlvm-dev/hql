import { getPlatform } from "../../platform/platform.ts";

/**
 * Shared ANSI color codes for CLI components.
 * Legacy constants - prefer using themed colors from theme system
 */
export const ANSI_COLORS = {
  SICP_PURPLE: "\x1b[38;2;102;51;153m",  // #663399 - SICP book cover purple
  BLUE: "\x1b[34m",
  CYAN: "\x1b[36m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  RED: "\x1b[31m",
  DIM_GRAY: "\x1b[90m",
  BOLD: "\x1b[1m",
  RESET: "\x1b[0m",
} as const;

// Re-export only what's needed for ANSI terminal output
export { getThemedAnsi } from "./theme/index.ts";

/**
 * Clear terminal screen and scrollback buffer.
 * Used for Ctrl+L and Cmd+K screen clear in REPL.
 */
export function clearTerminal(): void {
  const encoder = new TextEncoder();
  // \x1b[3J = clear scrollback, \x1b[2J = clear screen, \x1b[H = cursor home
  getPlatform().terminal.stdout.writeSync(encoder.encode("\x1b[3J\x1b[2J\x1b[H"));
}
