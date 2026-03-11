/**
 * Shared normalization for terminal text input.
 *
 * Preserve tabs/newlines, strip ANSI control sequences, and distinguish
 * multiline paste from batched single-line redraw/input frames.
 */

export type BufferedInputMode = "multiline" | "batched";

const ANSI_ESCAPE_REGEX = /\x1B\[[0-9;?]*[ -/]*[@-~]/g;
const PRESERVE_TEXT_CONTROLS_REGEX = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g;

/**
 * Strip terminal control sequences while preserving tabs/newlines/carriage returns.
 */
export function stripTerminalControlBytes(input: string): string {
  const withoutAnsi = input.replace(ANSI_ESCAPE_REGEX, "");
  return withoutAnsi.replace(PRESERVE_TEXT_CONTROLS_REGEX, "");
}

function applyCarriageReturnSemantics(input: string): string {
  const lines: string[][] = [[]];
  let lineIndex = 0;
  let column = 0;

  for (const ch of input) {
    if (ch === "\n") {
      lines.push([]);
      lineIndex += 1;
      column = 0;
      continue;
    }

    if (ch === "\r") {
      column = 0;
      continue;
    }

    const line = lines[lineIndex];
    line[column] = ch;
    column += 1;
  }

  return lines.map((line) => line.join("")).join("\n");
}

/**
 * Normalize buffered terminal input before insertion into the live prompt.
 *
 * - `multiline`: preserve pasted line breaks (Terminal.app often uses bare `\r`)
 * - `batched`: treat bare `\r` as carriage-return redraws, not new lines
 */
export function normalizeBufferedTextInput(
  input: string,
  mode: BufferedInputMode,
): string {
  const sanitized = stripTerminalControlBytes(input).replace(/\r\n/g, "\n");
  if (mode === "multiline") {
    return sanitized.replace(/\r/g, "\n");
  }
  return applyCarriageReturnSemantics(sanitized);
}
