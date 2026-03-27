/**
 * Shared UI constants for repl-ink overlay components.
 */

/** Cursor blink interval in ms (macOS standard) */
export const CURSOR_BLINK_MS = 530;

/** Shared spinner cadence for conversation UI motion. */
export const CONVERSATION_SPINNER_INTERVAL_MS = 250;

/** Braille spinner frames used by the shared conversation motion store. */
export const SPINNER_FRAMES = [
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

/** Shared status glyphs for conversation and overlay chrome. */
export const STATUS_GLYPHS = {
  pending: "○",
  running: "●",
  success: "✓",
  error: "✗",
  cancelled: "○",
  warning: "⚠",
  info: "ℹ",
} as const;


/** Shared helper hint for opening the transcript/history viewer. */
export const TOGGLE_LATEST_HINT = "Ctrl+O for history";
/** Shared helper hint for opening the latest citation URL. */
export const OPEN_LATEST_SOURCE_HINT = "Ctrl+Y opens latest source";

// ============================================================
// Terminal & Layout Defaults
// ============================================================

/** Default terminal width fallback when stdout columns is unavailable. */
export const DEFAULT_TERMINAL_WIDTH = 80;

/** Default terminal height fallback when stdout rows is unavailable. */
export const DEFAULT_TERMINAL_HEIGHT = 24;

/** Minimum width for picker/browser panels. */
export const MIN_PANEL_WIDTH = 48;

/** Standard padding subtracted from terminal width for panel sizing. */
export const PANEL_PADDING = 4;

/** Maximum width for the model browser panel. */
export const MODEL_BROWSER_MAX_WIDTH = 118;

export function clampPanelWidth(
  terminalWidth: number,
  {
    maxWidth,
    minWidth = MIN_PANEL_WIDTH,
    padding = PANEL_PADDING,
  }: {
    maxWidth: number;
    minWidth?: number;
    padding?: number;
  },
): number {
  const safeTerminalWidth = Math.max(1, terminalWidth);
  const availableWidth = Math.max(1, safeTerminalWidth - padding);

  if (availableWidth < minWidth) {
    return availableWidth;
  }

  return Math.min(maxWidth, availableWidth);
}

export function clampVisibleRows(
  terminalRows: number,
  {
    reservedRows,
    minRows,
    maxRows,
  }: {
    reservedRows: number;
    minRows: number;
    maxRows: number;
  },
): number {
  const availableRows = Math.max(1, terminalRows - reservedRows);
  return Math.max(1, Math.min(maxRows, Math.max(minRows, availableRows)));
}

// ============================================================
// CLI Cache
// ============================================================

/** Shared cache TTL for CLI file/model catalog caches (1 minute). */
export const CLI_CACHE_TTL_MS = 60_000;
