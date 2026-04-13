import { getPlatform } from "../../platform/platform.ts";

/**
 * Shared ANSI color codes for CLI components.
 * Legacy constants - prefer using themed colors from theme system
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
 * Used for in-app REPL flush / clear actions.
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

/**
 * Enable kitty keyboard protocol (progressive enhancement level 1).
 * Tells the terminal to send CSI-u sequences for modified keys
 * (e.g. Shift+Enter as \x1b[13;2u instead of plain \r).
 * Supported by: iTerm2, Kitty, WezTerm, Ghostty, Alacritty, VS Code terminal, foot.
 * Unsupported terminals silently ignore this sequence.
 */
export function enableKittyKeyboardProtocol(): void {
  writeTerminalSequence("\x1b[>1u");
}

/**
 * Disable/pop kitty keyboard protocol. Must be called on exit to restore
 * the terminal to its default keyboard mode.
 */
export function disableKittyKeyboardProtocol(): void {
  writeTerminalSequence("\x1b[<u");
}

/**
 * Enter the alternate screen buffer (DEC private mode 1049).
 * Content written before this call is preserved in the primary buffer
 * and restored when exitAlternateScreen() is called.
 */
export function enterAlternateScreen(): void {
  writeTerminalSequence("\x1b[?1049h\x1b[2J\x1b[H");
}

/**
 * Exit the alternate screen buffer and restore the primary buffer.
 * Must be called on exit to avoid leaving the terminal in alt mode.
 */
export function exitAlternateScreen(): void {
  writeTerminalSequence("\x1b[?1049l");
}
