/**
 * ANSI control code sanitization for model output.
 *
 * Strips dangerous ANSI escape sequences (cursor movement, screen clear,
 * title changes) while preserving safe SGR formatting (colors, bold, etc.).
 */

// CSI (Control Sequence Introducer) sequences: ESC [ ... <final byte>
// SGR (Select Graphic Rendition) ends with 'm' — these are safe (colors, bold, etc.)
// Dangerous: cursor movement (A-H, J, K, S, T), scroll, screen ops
const DANGEROUS_CSI_RE = /\x1b\[[0-9;]*[ABCDEFGHJKSTfnsu]/g;

// OSC (Operating System Command): ESC ] ... ST  — used for title changes, hyperlinks
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

// DCS (Device Control String): ESC P ... ST
const DCS_RE = /\x1bP[^\x1b]*\x1b\\/g;

// APC, PM, SOS sequences
const APC_PM_SOS_RE = /\x1b[_^X][^\x1b]*\x1b\\/g;

// Raw control characters (except newline, tab, carriage return)
const RAW_CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1a\x7f]/g;

/**
 * Escape dangerous ANSI control sequences from text while preserving
 * safe SGR formatting codes (colors, bold, underline, etc.).
 */
export function escapeAnsiCtrlCodes(text: string): string {
  return text
    .replace(DANGEROUS_CSI_RE, "")
    .replace(OSC_RE, "")
    .replace(DCS_RE, "")
    .replace(APC_PM_SOS_RE, "")
    .replace(RAW_CTRL_RE, "");
}

/**
 * Create an incremental sanitizer that caches the sanitized prefix.
 * During streaming, text is append-only — only the new suffix gets regex'd.
 * Falls back to full sanitization when the text doesn't start with the cached prefix.
 */
export function createIncrementalSanitizer(): (text: string) => string {
  let lastInput = "";
  let lastOutput = "";
  return (text: string) => {
    if (text === lastInput) return lastOutput;
    if (text.startsWith(lastInput)) {
      const sanitizedSuffix = escapeAnsiCtrlCodes(text.slice(lastInput.length));
      lastInput = text;
      lastOutput = lastOutput + sanitizedSuffix;
      return lastOutput;
    }
    lastInput = text;
    lastOutput = escapeAnsiCtrlCodes(text);
    return lastOutput;
  };
}
