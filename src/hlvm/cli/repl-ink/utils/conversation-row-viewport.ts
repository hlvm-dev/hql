/**
 * Row-aware conversation viewport helpers.
 *
 * The shell transcript renders variable-height items (markdown, code blocks,
 * tool groups). Item-count-based slicing is not sufficient because 3 items
 * might consume 3 rows or 30 rows depending on content.
 *
 * These helpers keep scrolling state in rows while still returning whole-item
 * windows for rendering.
 */

export interface ConversationRowViewport {
  start: number;
  end: number;
  hiddenAbove: number;
  hiddenBelow: number;
  maxOffset: number;
  totalRows: number;
}

function normalizeRowHeights(
  rowHeights: readonly number[],
): number[] {
  return rowHeights.map((height) =>
    Number.isFinite(height) && height > 0 ? Math.ceil(height) : 1
  );
}

export function clampConversationRowScrollOffset(
  scrollOffset: number,
  totalRows: number,
  visibleRows: number,
): number {
  const maxOffset = Math.max(0, totalRows - visibleRows);
  return Math.max(0, Math.min(maxOffset, scrollOffset));
}

export function computeConversationRowViewport(
  rowHeights: readonly number[],
  visibleRows: number,
  scrollOffsetFromBottom: number,
): ConversationRowViewport {
  const heights = normalizeRowHeights(rowHeights);
  const totalRows = heights.reduce((sum, height) => sum + height, 0);
  const offset = clampConversationRowScrollOffset(
    scrollOffsetFromBottom,
    totalRows,
    visibleRows,
  );

  let end = heights.length;
  let remainingOffset = offset;
  while (end > 0 && remainingOffset >= heights[end - 1]) {
    remainingOffset -= heights[end - 1];
    end -= 1;
  }

  let start = end;
  let usedRows = 0;
  while (start > 0) {
    const nextHeight = heights[start - 1];
    if (usedRows > 0 && usedRows + nextHeight > visibleRows) {
      break;
    }
    usedRows += nextHeight;
    start -= 1;
    if (usedRows >= visibleRows) {
      break;
    }
  }

  return {
    start,
    end,
    hiddenAbove: start,
    hiddenBelow: heights.length - end,
    maxOffset: Math.max(0, totalRows - visibleRows),
    totalRows,
  };
}
