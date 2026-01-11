/**
 * Unified Completion System - Dropdown Component
 *
 * GENERIC dropdown that renders items via getRenderSpec().
 * No provider-specific logic - all behavior defined by providers.
 *
 * Scroll calculation is INTERNAL - no external scroll props needed.
 */

import React, { useMemo } from "npm:react@18";
import { Text, Box } from "npm:ink@5";
import type { CompletionItem, ScrollWindow, ItemRenderSpec } from "./types.ts";
import { MAX_VISIBLE_ITEMS } from "./types.ts";
import { HighlightedText } from "../components/HighlightedText.tsx";
import { useTheme } from "../../theme/index.ts";

// ============================================================
// Truncation (Dropdown-specific)
// ============================================================

/**
 * Truncate and adjust match indices accordingly.
 * Returns truncated label and adjusted indices.
 */
function truncateWithIndices(
  label: string,
  maxWidth: number,
  strategy: "start" | "end" | "none",
  indices?: readonly number[]
): { label: string; indices: readonly number[] } {
  if (strategy === "none" || label.length <= maxWidth) {
    return { label, indices: indices ?? [] };
  }

  if (strategy === "start") {
    // Truncate from start (show end of path): "…" + last (maxWidth-1) chars
    const offset = label.length - (maxWidth - 1);
    const truncated = "…" + label.slice(offset);
    // Shift indices: subtract offset, filter out negative, add 1 for "…"
    const adjusted = (indices ?? [])
      .map(i => i - offset + 1)
      .filter(i => i > 0 && i < truncated.length);
    return { label: truncated, indices: adjusted };
  }

  // Truncate from end: first (maxWidth-1) chars + "…"
  const truncated = label.slice(0, maxWidth - 1) + "…";
  const adjusted = (indices ?? []).filter(i => i < maxWidth - 1);
  return { label: truncated, indices: adjusted };
}

interface TruncatedHighlightedTextProps {
  readonly label: string;
  readonly matchIndices?: readonly number[];
  readonly maxWidth: number;
  readonly truncate: "start" | "end" | "none";
  readonly isSelected: boolean;
}

/**
 * Render text with truncation and fuzzy match highlighting.
 * Uses shared HighlightedText component for actual highlighting.
 */
function TruncatedHighlightedText({
  label,
  matchIndices,
  maxWidth,
  truncate,
  isSelected,
}: TruncatedHighlightedTextProps): React.ReactElement {
  const { color } = useTheme();
  const { label: truncatedLabel, indices } = truncateWithIndices(
    label,
    maxWidth,
    truncate,
    matchIndices
  );

  return (
    <HighlightedText
      text={truncatedLabel}
      matchIndices={indices.length > 0 ? indices : undefined}
      baseColor={isSelected ? color("accent") : undefined}
      inverse={isSelected}
    />
  );
}

// ============================================================
// Generic Item Rendering
// ============================================================

interface GenericItemProps {
  /** React key for list rendering */
  readonly key?: string | number;
  /** The render specification for this item */
  readonly spec: ItemRenderSpec;
  /** Whether this item is selected */
  readonly isSelected: boolean;
}

/**
 * Generic item renderer - uses ItemRenderSpec to display any completion item.
 * Now supports fuzzy match highlighting via matchIndices.
 */
function GenericItem({ spec, isSelected }: GenericItemProps): React.ReactElement {
  const { color } = useTheme();
  return (
    <Box>
      <Text color={isSelected ? color("accent") : undefined} inverse={isSelected}>
        {spec.icon}{" "}
      </Text>
      <TruncatedHighlightedText
        label={spec.label}
        matchIndices={spec.matchIndices}
        maxWidth={spec.maxWidth}
        truncate={spec.truncate}
        isSelected={isSelected}
      />
      {spec.description && <Text dimColor> {spec.description}</Text>}
      {spec.typeLabel && <Text color="gray"> {spec.typeLabel}</Text>}
    </Box>
  );
}

// ============================================================
// Documentation Panel
// ============================================================

interface DocPanelProps {
  /** Extended documentation text */
  readonly doc: string;
}

/** Max lines to show in DocPanel before truncating */
const DOC_PANEL_MAX_LINES = 12;

/**
 * Documentation panel shown below dropdown when item has extended docs.
 * Shows multi-line documentation in a bordered box.
 */
function DocPanel({ doc }: DocPanelProps): React.ReactElement {
  // Split into lines and limit to max
  const lines = doc.split("\n").slice(0, DOC_PANEL_MAX_LINES);
  const hasMore = doc.split("\n").length > DOC_PANEL_MAX_LINES;

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
      {lines.map((line, i) => (
        <React.Fragment key={i}>
          <Text dimColor>{line}</Text>
        </React.Fragment>
      ))}
      {hasMore && <Text dimColor>...</Text>}
    </Box>
  );
}

// ============================================================
// Scroll Calculation (internal)
// ============================================================

/**
 * Calculate the visible window for virtualization.
 * Keeps the selected item visible by centering it when possible.
 */
function calculateScrollWindow(
  selectedIndex: number,
  itemCount: number,
  visibleCount: number = MAX_VISIBLE_ITEMS
): ScrollWindow {
  if (itemCount <= visibleCount) {
    return { start: 0, end: itemCount };
  }

  const halfVisible = Math.floor(visibleCount / 2);
  let start = Math.max(0, selectedIndex - halfVisible);
  let end = start + visibleCount;

  if (end > itemCount) {
    end = itemCount;
    start = Math.max(0, end - visibleCount);
  }

  return { start, end };
}

// ============================================================
// Dropdown Component
// ============================================================

interface DropdownProps {
  /** Items to display (full list, will be virtualized) */
  readonly items: readonly CompletionItem[];
  /** Currently selected index (-1 for none) */
  readonly selectedIndex: number;
  /** Help text to display (from provider) */
  readonly helpText: string;
  /** Whether the dropdown is loading */
  readonly isLoading: boolean;
  /** Margin from left edge */
  readonly marginLeft?: number;
  /** Max visible items (default 8) */
  readonly maxVisible?: number;
  /** Whether user has navigated with arrow keys (only show DocPanel then) */
  readonly hasNavigated?: boolean;
}

/**
 * Dropdown component for displaying completion suggestions.
 *
 * FULLY GENERIC - no provider-specific logic.
 * Each item defines its own rendering via getRenderSpec().
 *
 * Features:
 * - FIXED HEIGHT: Always renders MAX_VISIBLE_ITEMS rows (prevents UI shaking)
 * - Virtualized rendering (only visible items rendered)
 * - Scroll indicators (↑↓) for large lists
 * - Loading state display
 * - Customizable help text
 * - INTERNAL scroll calculation (no external props needed)
 */
export function Dropdown(props: DropdownProps): React.ReactElement | null {
  const {
    items,
    selectedIndex,
    helpText,
    isLoading,
    marginLeft = 5,
    maxVisible = MAX_VISIBLE_ITEMS,
    hasNavigated = false,
  } = props;

  // Don't render if no items and not loading
  if (items.length === 0 && !isLoading) {
    return null;
  }

  // Calculate scroll window internally
  const scrollWindow = useMemo(
    () => calculateScrollWindow(selectedIndex, items.length, maxVisible),
    [selectedIndex, items.length, maxVisible]
  );

  const hasMoreAbove = useMemo(() => scrollWindow.start > 0, [scrollWindow.start]);
  const hasMoreBelow = useMemo(() => scrollWindow.end < items.length, [scrollWindow.end, items.length]);

  // Get visible items from scroll window
  const visibleItems = items.slice(scrollWindow.start, scrollWindow.end);

  // Calculate padding needed for fixed height (prevents UI shaking)
  const paddingCount = Math.max(0, maxVisible - visibleItems.length);

  // Get selected item's extended doc (if any)
  const selectedItem = selectedIndex >= 0 && selectedIndex < items.length
    ? items[selectedIndex]
    : null;
  const extendedDoc = selectedItem?.getRenderSpec().extendedDoc;

  return (
    <Box flexDirection="column" marginLeft={marginLeft}>
      {/* Loading indicator */}
      {isLoading && items.length === 0 && (
        <Text dimColor>Searching...</Text>
      )}

      {/* Scroll up indicator (or empty line for fixed height) */}
      {hasMoreAbove ? (
        <Text dimColor>  ↑ more</Text>
      ) : (
        <Text> </Text>
      )}

      {/* Visible items - GENERIC rendering via getRenderSpec() */}
      {visibleItems.map((item, i) => {
        const isSelected = scrollWindow.start + i === selectedIndex;
        const spec = item.getRenderSpec();
        return <GenericItem key={item.id} spec={spec} isSelected={isSelected} />;
      })}

      {/* Empty padding rows for fixed height (prevents shaking) */}
      {Array.from({ length: paddingCount }, (_, i) => (
        <React.Fragment key={`pad-${i}`}>
          <Text> </Text>
        </React.Fragment>
      ))}

      {/* Scroll down indicator (or empty line for fixed height) */}
      {hasMoreBelow ? (
        <Text dimColor>  ↓ more</Text>
      ) : (
        <Text> </Text>
      )}

      {/* Help hint from provider */}
      {items.length > 0 && (
        <Text dimColor>  {helpText}</Text>
      )}

      {/* Extended documentation panel (only when user has navigated with arrow keys) */}
      {hasNavigated && extendedDoc && <DocPanel doc={extendedDoc} />}
    </Box>
  );
}

// ============================================================
// Exports
// ============================================================

export { GenericItem };
export type { DropdownProps, GenericItemProps };
