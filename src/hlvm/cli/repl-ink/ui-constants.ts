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

/** Shared helper hint for expanding/collapsing latest tool/thinking section. */
export const TOGGLE_LATEST_HINT = "Ctrl+O toggles latest section";
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

/** Maximum width for the session picker panel. */
export const SESSION_PICKER_MAX_WIDTH = 96;

/** Maximum width for the model browser panel. */
export const MODEL_BROWSER_MAX_WIDTH = 118;

// ============================================================
// CLI Cache
// ============================================================

/** Shared cache TTL for CLI file/model catalog caches (1 minute). */
export const CLI_CACHE_TTL_MS = 60_000;
