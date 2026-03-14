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
