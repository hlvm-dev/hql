/**
 * Conversation viewport helpers.
 *
 * Computes a stable item window for long conversation histories.
 * Pure functions only: no React/Ink dependency.
 */

interface ConversationViewport {
  start: number;
  end: number;
  hiddenAbove: number;
  hiddenBelow: number;
  maxOffset: number;
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
 * Clamp item-based scroll offset from bottom.
 */
export function clampConversationScrollOffset(
  scrollOffset: number,
  itemCount: number,
  visibleCount: number,
): number {
  const maxOffset = Math.max(0, itemCount - visibleCount);
  return Math.max(0, Math.min(maxOffset, scrollOffset));
}

/**
 * Compute the visible item range using "offset from bottom" semantics.
 */
export function computeConversationViewport(
  itemCount: number,
  visibleCount: number,
  scrollOffsetFromBottom: number,
): ConversationViewport {
  const maxOffset = Math.max(0, itemCount - visibleCount);
  const offset = clampConversationScrollOffset(
    scrollOffsetFromBottom,
    itemCount,
    visibleCount,
  );
  const start = Math.max(0, itemCount - visibleCount - offset);
  const end = Math.min(itemCount, start + visibleCount);
  return {
    start,
    end,
    hiddenAbove: start,
    hiddenBelow: itemCount - end,
    maxOffset,
  };
}
