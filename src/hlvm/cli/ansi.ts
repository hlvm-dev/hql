import { getPlatform } from "../../platform/platform.ts";

/**
 * Shared ANSI color codes for CLI components.
 * Prefer themed colors from the theme system for new code.
 */
export const ANSI_COLORS = {
  BLUE: "\x1b[34m",
  CYAN: "\x1b[36m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  RED: "\x1b[31m",
  DIM: "\x1b[2m",
  DIM_GRAY: "\x1b[90m",
  BOLD: "\x1b[1m",
  RESET: "\x1b[0m",
} as const;

const textEncoder = new TextEncoder();

/**
 * Clear terminal screen and scrollback buffer.
 * Used for in-app REPL flush / clear actions.
 */
export function clearTerminal(): void {
  getPlatform().terminal.stdout.writeSync(
    textEncoder.encode("\x1b[3J\x1b[2J\x1b[H"),
  );
}
