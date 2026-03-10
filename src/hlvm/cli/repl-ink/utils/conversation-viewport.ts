/**
 * Conversation viewport helpers.
 *
 * Computes a stable item window for long conversation histories.
 * Pure functions only: no React/Ink dependency.
 */

export interface ConversationViewport {
  start: number;
  end: number;
  hiddenAbove: number;
  hiddenBelow: number;
  maxOffset: number;
}

function normalizeVisibleRows(visibleRows: number): number {
  return Math.max(1, visibleRows);
}

function normalizeRowHeight(rowHeight: number): number {
  return Math.max(1, rowHeight);
}

function getTotalRows(rowHeights: readonly number[]): number {
  return rowHeights.reduce(
    (sum: number, rowHeight: number) => sum + normalizeRowHeight(rowHeight),
    0,
  );
}

/**
 * Estimate how many conversation items can be shown based on terminal rows.
 */
export function getConversationVisibleCount(
  terminalRows: number,
  options: {
    reservedRows?: number;
    minVisible?: number;
    maxVisible?: number;
  } = {},
): number {
  const reservedRows = options.reservedRows ?? 10;
  const minVisible = options.minVisible ?? 6;
  const maxVisible = options.maxVisible ?? 120;
  const raw = terminalRows - reservedRows;
  return Math.max(minVisible, Math.min(maxVisible, raw));
}

/**
 * Clamp row-based scroll offset from bottom.
 */
export function clampConversationScrollOffset(
  scrollOffset: number,
  rowHeights: readonly number[],
  visibleRows: number,
): number {
  const maxOffset = Math.max(
    0,
    getTotalRows(rowHeights) - normalizeVisibleRows(visibleRows),
  );
  return Math.max(0, Math.min(maxOffset, scrollOffset));
}

/**
 * Compute the visible item range using "offset from bottom" row semantics.
 */
export function computeConversationViewport(
  rowHeights: readonly number[],
  visibleRows: number,
  scrollOffsetFromBottom: number,
): ConversationViewport {
  if (rowHeights.length === 0) {
    return {
      start: 0,
      end: 0,
      hiddenAbove: 0,
      hiddenBelow: 0,
      maxOffset: 0,
    };
  }

  const totalRows = getTotalRows(rowHeights);
  const normalizedVisibleRows = normalizeVisibleRows(visibleRows);
  const maxOffset = Math.max(0, totalRows - normalizedVisibleRows);
  const offset = clampConversationScrollOffset(
    scrollOffsetFromBottom,
    rowHeights,
    normalizedVisibleRows,
  );
  const windowEndRow = totalRows - offset;
  const windowStartRow = Math.max(0, windowEndRow - normalizedVisibleRows);

  let start = rowHeights.length;
  let end = 0;
  let cursor = 0;

  for (let index = 0; index < rowHeights.length; index++) {
    const height = normalizeRowHeight(rowHeights[index]);
    const itemStartRow = cursor;
    const itemEndRow = cursor + height;
    const intersectsWindow = itemEndRow > windowStartRow &&
      itemStartRow < windowEndRow;

    if (intersectsWindow) {
      if (start === rowHeights.length) {
        start = index;
      }
      end = index + 1;
    }

    cursor = itemEndRow;
  }

  if (start === rowHeights.length) {
    start = Math.max(0, rowHeights.length - 1);
    end = rowHeights.length;
  }

  return {
    start,
    end,
    hiddenAbove: start,
    hiddenBelow: rowHeights.length - end,
    maxOffset,
  };
}
