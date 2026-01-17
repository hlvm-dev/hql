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
 * Terminal control sequences for screen manipulation.
 */
export const ANSI_CONTROLS = {
  CLEAR_SCREEN: "\x1b[2J",      // Clear entire screen
  CLEAR_SCROLLBACK: "\x1b[3J",  // Clear scrollback buffer (iTerm2, Terminal.app)
  CURSOR_HOME: "\x1b[H",        // Move cursor to top-left
  CLEAR_LINE: "\x1b[K",         // Clear from cursor to end of line
} as const;

/**
 * Clear terminal screen and scrollback buffer.
 * Used for Ctrl+L and Cmd+K screen clear in REPL.
 */
export function clearTerminal(): void {
  const encoder = new TextEncoder();
  getPlatform().terminal.stdout.writeSync(encoder.encode(
    ANSI_CONTROLS.CLEAR_SCROLLBACK + ANSI_CONTROLS.CLEAR_SCREEN + ANSI_CONTROLS.CURSOR_HOME
  ));
}
