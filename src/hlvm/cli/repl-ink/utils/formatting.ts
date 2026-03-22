/**
 * Shared formatting helpers for REPL/TUI rendering.
 */

/** Pad or truncate a string to an exact visible width. */
export function padTo(str: string, len: number): string {
  return str.length >= len
    ? str.slice(0, len)
    : str + " ".repeat(len - str.length);
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/** Truncate a single line to fit within maxWidth, appending an ellipsis if truncated. */
export function truncateLine(text: string, maxWidth: number): string {
  if (maxWidth < 4) return text;
  if (text.length <= maxWidth) return text;
  return `${text.slice(0, maxWidth - 1)}\u2026`;
}

/** Format elapsed milliseconds to a compact human-readable duration (e.g. "3s", "2m 15s", "1h 5m"). */
export function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

/** Shared bar characters for progress indicators. */
export const BAR_CHARS = { filled: "\u2588", empty: "\u2591" } as const;

/** Render a plain-text progress bar from 0-100 percent (e.g. "████░░░░"). */
export function formatProgressBar(percent: number, width = 8): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  return BAR_CHARS.filled.repeat(filled) + BAR_CHARS.empty.repeat(width - filled);
}
