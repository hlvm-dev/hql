/**
 * Shared cursor-windowing helpers for fixed-width TUI inputs.
 *
 * Used by both Ink-rendered fields and raw ANSI overlays so long inputs
 * stay editable without duplicating width math.
 */

export interface CursorWindowDisplay {
  beforeCursor: string;
  cursorChar: string;
  afterCursor: string;
  renderWidth: number;
}

/**
 * Build a fixed-width visible window around a cursor.
 *
 * The returned segments are safe to render in `maxCells` columns, including
 * the cursor cell itself. When the cursor is at end-of-input, the cursor cell
 * becomes a blank space after the last visible character.
 */
export function buildCursorWindowDisplay(
  value: string,
  cursor: number,
  maxCells: number,
): CursorWindowDisplay {
  if (maxCells <= 0) {
    return {
      beforeCursor: "",
      cursorChar: " ",
      afterCursor: "",
      renderWidth: 0,
    };
  }

  const clampedCursor = Math.max(0, Math.min(cursor, value.length));

  if (clampedCursor >= value.length) {
    const maxTextCells = Math.max(0, maxCells - 1);
    const start = Math.max(0, value.length - maxTextCells);
    const visible = value.slice(start);
    return {
      beforeCursor: visible,
      cursorChar: " ",
      afterCursor: "",
      renderWidth: visible.length + 1,
    };
  }

  if (value.length <= maxCells) {
    return {
      beforeCursor: value.slice(0, clampedCursor),
      cursorChar: value[clampedCursor] || " ",
      afterCursor: value.slice(clampedCursor + 1),
      renderWidth: value.length,
    };
  }

  const start = Math.max(
    0,
    Math.min(clampedCursor - maxCells + 1, value.length - maxCells),
  );
  const visible = value.slice(start, start + maxCells);
  const cursorOffset = Math.max(
    0,
    Math.min(clampedCursor - start, visible.length - 1),
  );

  return {
    beforeCursor: visible.slice(0, cursorOffset),
    cursorChar: visible[cursorOffset] || " ",
    afterCursor: visible.slice(cursorOffset + 1),
    renderWidth: visible.length,
  };
}
