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
  DIM: "\x1b[2m",
  DIM_GRAY: "\x1b[90m",
  BOLD: "\x1b[1m",
  RESET: "\x1b[0m",
} as const;

// Re-export only what's needed for ANSI terminal output
export { getThemedAnsi } from "./theme/index.ts";

function getTerminalClearSequence(
  options: { clearScrollback?: boolean } = {},
): string {
  const { clearScrollback = true } = options;
  return clearScrollback ? "\x1b[3J\x1b[2J\x1b[H" : "\x1b[2J\x1b[H";
}

// Module-level encoder avoids per-call allocation (TextEncoder is stateless and reusable)
const textEncoder = new TextEncoder();

function writeTerminalSequence(sequence: string): void {
  getPlatform().terminal.stdout.writeSync(textEncoder.encode(sequence));
}

/**
 * Clear terminal screen and scrollback buffer.
 * Used for Ctrl+L and Cmd+K screen clear in REPL.
 */
export function clearTerminal(): void {
  writeTerminalSequence(getTerminalClearSequence());
}

/**
 * Reset the visible terminal viewport without destroying scrollback.
 * Used when launching fullscreen-ish REPL surfaces after build/log output.
 */
export function resetTerminalViewport(): void {
  writeTerminalSequence(getTerminalClearSequence({ clearScrollback: false }));
}
