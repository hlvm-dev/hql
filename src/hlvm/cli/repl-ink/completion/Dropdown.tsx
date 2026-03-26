/**
 * Unified Completion System - Dropdown Component
 *
 * GENERIC dropdown that renders items via getRenderSpec().
 * No provider-specific logic - all behavior defined by providers.
 *
 * Scroll calculation is INTERNAL - no external scroll props needed.
 */

import React, { useMemo } from "react";
import { Text, Box } from "ink";
import { MAX_VISIBLE_ITEMS, type CompletionItem, type ItemRenderSpec } from "./types.ts";
import { calculateScrollWindow } from "./navigation.ts";
import { HighlightedText } from "../components/HighlightedText.tsx";
import { useTheme } from "../../theme/index.ts";

const SELECTOR_COLUMN_WIDTH = 2;
const META_COLUMN_WIDTH = 10;
const PANEL_MIN_WIDTH = 24;
const PANEL_MAX_WIDTH = 64;

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
  /** Available width for the row */
  readonly width?: number;
}

/**
 * Generic item renderer - uses ItemRenderSpec to display any completion item.
 * Dense code-first layout: [selector] [label] [kind]
 */
function GenericItem({
  spec,
  isSelected,
  width,
}: GenericItemProps): React.ReactElement {
  const { color } = useTheme();
  const rowWidth = Math.max(PANEL_MIN_WIDTH, Math.min(width ?? PANEL_MAX_WIDTH, PANEL_MAX_WIDTH));
  const rightMeta = spec.typeLabel ?? "";
  const labelWidth = Math.max(
    12,
    Math.min(
      spec.maxWidth,
      rowWidth - SELECTOR_COLUMN_WIDTH - 1 - (rightMeta ? META_COLUMN_WIDTH : 0),
    ),
  );
  return (
    <Box width={rowWidth}>
      <Box width={SELECTOR_COLUMN_WIDTH}>
        <Text color={isSelected ? color("accent") : undefined}>
          {isSelected ? "›" : " "}
        </Text>
      </Box>
      <Text> </Text>
      <Box width={labelWidth}>
        <TruncatedHighlightedText
          label={spec.label}
          matchIndices={spec.matchIndices}
          maxWidth={labelWidth}
          truncate={spec.truncate}
          isSelected={isSelected}
        />
      </Box>
      {rightMeta && (
        <Box width={META_COLUMN_WIDTH} justifyContent="flex-end">
          <Text dimColor color={isSelected ? color("muted") : undefined}>
            {rightMeta}
          </Text>
        </Box>
      )}
    </Box>
  );
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
  /** Max visible items */
  readonly maxVisible?: number;
  /** Whether to show DocPanel (toggled with Ctrl+D shortcut) */
  readonly showDocPanel?: boolean;
  /** Available width */
  readonly width?: number;
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
    marginLeft = 1,
    maxVisible = MAX_VISIBLE_ITEMS,
    showDocPanel = false,
    width,
  } = props;
  const panelWidth = Math.max(
    PANEL_MIN_WIDTH,
    Math.min(width ?? PANEL_MAX_WIDTH, PANEL_MAX_WIDTH),
  );

  // Don't render if no items and not loading
  if (items.length === 0 && !isLoading) {
    return null;
  }

  // Calculate scroll window internally
  const scrollWindow = useMemo(
    () => calculateScrollWindow(selectedIndex, items.length, maxVisible),
    [selectedIndex, items.length, maxVisible]
  );

  // Trivial comparisons — no need for useMemo
  const hasMoreAbove = scrollWindow.start > 0;
  const hasMoreBelow = scrollWindow.end < items.length;

  // Get visible items from scroll window
  const visibleItems = items.slice(scrollWindow.start, scrollWindow.end);

  // Calculate padding needed for fixed height (prevents UI shaking)
  const paddingCount = Math.max(0, maxVisible - visibleItems.length);

  // Get selected item's extended doc (if any)
  const selectedItem = selectedIndex >= 0 && selectedIndex < items.length
    ? items[selectedIndex]
    : null;
  const selectedSpec = selectedItem?.getRenderSpec();
  const extendedDoc = selectedSpec?.extendedDoc;

  const previewLines = useMemo(() => {
    const lines: string[] = [];
    if (selectedSpec?.description) {
      lines.push(selectedSpec.description);
    }
    if (extendedDoc) {
      const limit = showDocPanel ? 2 : 1;
      lines.push(...extendedDoc.split("\n").filter(Boolean).slice(0, limit));
    }
    return lines.slice(0, showDocPanel ? 3 : 2);
  }, [extendedDoc, selectedSpec, showDocPanel]);

  return (
    <Box
      flexDirection="column"
      marginLeft={marginLeft}
      marginTop={1}
      marginBottom={1}
      width={panelWidth}
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
    >
      {/* Loading indicator */}
      {isLoading && items.length === 0 && (
        <Text dimColor>Searching...</Text>
      )}

      {/* Scroll up indicator */}
      {hasMoreAbove ? (
        <Text dimColor>…</Text>
      ) : null}

      {/* Visible items - GENERIC rendering via getRenderSpec() */}
      {visibleItems.map((item, i) => {
        const isSelected = scrollWindow.start + i === selectedIndex;
        const spec = item.getRenderSpec();
        return (
          <GenericItem
            key={item.id}
            spec={spec}
            isSelected={isSelected}
            width={panelWidth - 2}
          />
        );
      })}

      {/* Empty padding rows for fixed height (prevents shaking) */}
      {Array.from({ length: paddingCount }, (_, i) => (
        <React.Fragment key={`pad-${i}`}>
          <Text> </Text>
        </React.Fragment>
      ))}

      {/* Scroll down indicator */}
      {hasMoreBelow ? (
        <Text dimColor>…</Text>
      ) : null}

      {items.length > 0 && (
        <Box marginTop={1}>
          <Text dimColor>{helpText}</Text>
        </Box>
      )}

      {previewLines.map((line: string, index: number) => (
        <Text key={`${selectedItem?.id ?? "doc"}-${index}`} dimColor>
          {line}
        </Text>
      ))}
      {showDocPanel && !extendedDoc && (
        <Text dimColor>(no documentation available)</Text>
      )}
    </Box>
  );
}

// ============================================================
// Exports
// ============================================================
