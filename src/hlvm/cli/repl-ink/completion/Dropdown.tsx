/**
 * Unified Completion System - Dropdown Component
 *
 * GENERIC dropdown that renders items via getRenderSpec().
 * No provider-specific logic - all behavior defined by providers.
 *
 * Scroll calculation is INTERNAL - no external scroll props needed.
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import {
  type CompletionItem,
  type ItemRenderSpec,
  MAX_VISIBLE_ITEMS,
  type ProviderId,
} from "./types.ts";
import { calculateScrollWindow } from "./navigation.ts";
import { PickerRow } from "../components/PickerRow.tsx";
import { HighlightedText } from "../components/HighlightedText.tsx";
import { useSemanticColors } from "../../theme/index.ts";
import { getPickerColors, type PickerColors } from "../utils/picker-theme.ts";
import {
  COMPLETION_PANEL_CHROME_WIDTH,
  COMPLETION_PANEL_MAX_WIDTH,
  measureCompletionPanelWidth,
} from "../utils/completion-layout.ts";
import { truncate } from "../../../../common/utils.ts";

const SELECTOR_COLUMN_WIDTH = 2;
const META_COLUMN_WIDTH = 10;
const COMMAND_MARKER_WIDTH = 2;
const COMMAND_MIN_LABEL_WIDTH = 12;
const COMMAND_MAX_LABEL_WIDTH = 18;

// ============================================================
// Generic Item Rendering
// ============================================================

interface GenericItemProps {
  /** React key for list rendering */
  readonly key?: string | number;
  /** The render specification for this item */
  readonly spec: ItemRenderSpec;
  /** Shared picker chrome colors */
  readonly pickerColors: PickerColors;
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
  pickerColors,
  isSelected,
  width,
}: GenericItemProps): React.ReactElement {
  const rowWidth = Math.max(1, width ?? COMPLETION_PANEL_MAX_WIDTH);
  return (
    <PickerRow
      label={spec.label}
      matchIndices={spec.matchIndices}
      pickerColors={pickerColors}
      isSelected={isSelected}
      width={rowWidth}
      markerText={isSelected ? "›" : " "}
      markerWidth={SELECTOR_COLUMN_WIDTH}
      metaText={spec.typeLabel}
      metaWidth={META_COLUMN_WIDTH}
      maxLabelWidth={spec.maxWidth}
      truncate={spec.truncate}
    />
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
  /** Active provider determines the chrome variant */
  readonly providerId?: ProviderId;
  /** Margin from left edge */
  readonly marginLeft?: number;
  /** Margin from the composer above */
  readonly marginTop?: number;
  /** Margin below the panel */
  readonly marginBottom?: number;
  /** Max visible items */
  readonly maxVisible?: number;
  /** Whether to show DocPanel (toggled with Ctrl+D shortcut) */
  readonly showDocPanel?: boolean;
  /** Available width */
  readonly width?: number;
}

interface CommandItemRowProps {
  readonly key?: string | number;
  readonly item: CompletionItem;
  readonly isSelected: boolean;
  readonly commandColumnWidth: number;
  readonly width: number;
  readonly pickerColors: PickerColors;
  readonly accentColor: string;
  readonly mutedColor: string;
}

function CommandItemRow({
  item,
  isSelected,
  commandColumnWidth,
  width,
  pickerColors,
  accentColor,
  mutedColor,
}: CommandItemRowProps): React.ReactElement {
  const renderSpec = item.getRenderSpec();
  const commandColor = isSelected ? accentColor : pickerColors.rowForeground;
  const highlightColor = isSelected
    ? pickerColors.selectedMatch
    : pickerColors.rowMatch;
  const descriptionColor = isSelected ? pickerColors.rowForeground : mutedColor;
  const descriptionWidth = Math.max(
    1,
    width - COMMAND_MARKER_WIDTH - commandColumnWidth,
  );
  const description = renderSpec.description
    ? truncate(renderSpec.description, descriptionWidth, "…")
    : "";

  return (
    <Box width={width}>
      <Box width={COMMAND_MARKER_WIDTH}>
        <Text color={isSelected ? accentColor : mutedColor}>
          {isSelected ? "›" : " "}
        </Text>
      </Box>
      <Box width={commandColumnWidth}>
        <HighlightedText
          text={renderSpec.label}
          matchIndices={renderSpec.matchIndices}
          baseColor={commandColor}
          highlightColor={highlightColor}
          bold={isSelected}
        />
      </Box>
      <Box width={descriptionWidth}>
        <Text color={descriptionColor} dimColor={!isSelected}>
          {description}
        </Text>
      </Box>
    </Box>
  );
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
    providerId,
    marginLeft = 1,
    marginTop = 0,
    marginBottom = 1,
    maxVisible = MAX_VISIBLE_ITEMS,
    showDocPanel = false,
    width,
  } = props;
  const sc = useSemanticColors();
  const pickerColors = getPickerColors(sc);
  const isCommandMenu = providerId === "command";

  // Don't render if no items and not loading
  if (items.length === 0 && !isLoading) {
    return null;
  }

  // Calculate scroll window internally
  const scrollWindow = useMemo(
    () => calculateScrollWindow(selectedIndex, items.length, maxVisible),
    [selectedIndex, items.length, maxVisible],
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
    if (isCommandMenu) {
      return [];
    }
    const lines: string[] = [];
    if (selectedSpec?.description) {
      lines.push(selectedSpec.description);
    }
    if (extendedDoc) {
      const limit = showDocPanel ? 2 : 1;
      lines.push(...extendedDoc.split("\n").filter(Boolean).slice(0, limit));
    }
    return lines.slice(0, showDocPanel ? 3 : 2);
  }, [extendedDoc, isCommandMenu, selectedSpec, showDocPanel]);

  const panelWidth = useMemo(() => {
    if (isCommandMenu) {
      return Math.max(1, width ?? COMPLETION_PANEL_MAX_WIDTH);
    }
    const rowWidths = items.map((item: CompletionItem) => {
      const spec = item.getRenderSpec();
      const fittedLabelWidth = spec.truncate === "none"
        ? spec.label.length
        : Math.min(spec.label.length, spec.maxWidth);
      return SELECTOR_COLUMN_WIDTH + 1 + fittedLabelWidth +
        (spec.typeLabel ? META_COLUMN_WIDTH : 0);
    });

    return measureCompletionPanelWidth({
      rowWidths,
      helpText: items.length > 0 ? helpText : undefined,
      previewLines,
      maxWidth: width,
    });
  }, [helpText, isCommandMenu, items, previewLines, width]);
  const innerWidth = Math.max(1, panelWidth - COMPLETION_PANEL_CHROME_WIDTH);
  const commandColumnWidth = useMemo(
    () => {
      const longestLabel = items.length > 0
        ? Math.max(...items.map((item: CompletionItem) => item.label.length))
        : 0;
      return Math.max(
        COMMAND_MIN_LABEL_WIDTH,
        Math.min(COMMAND_MAX_LABEL_WIDTH, longestLabel + 2),
      );
    },
    [items],
  );

  if (isCommandMenu) {
    return (
      <Box
        flexDirection="column"
        marginLeft={marginLeft}
        marginTop={marginTop}
        marginBottom={marginBottom}
        width={panelWidth}
      >
        {isLoading && items.length === 0 && (
          <Text color={pickerColors.previewColor} dimColor>Searching...</Text>
        )}
        {hasMoreAbove
          ? <Text color={pickerColors.separatorColor}>…</Text>
          : null}
        {visibleItems.map((item, i) => {
          const isSelected = scrollWindow.start + i === selectedIndex;
          return (
            <CommandItemRow
              key={item.id}
              item={item}
              isSelected={isSelected}
              commandColumnWidth={commandColumnWidth}
              width={panelWidth}
              pickerColors={pickerColors}
              accentColor={sc.chrome.sectionLabel}
              mutedColor={sc.text.muted}
            />
          );
        })}
        {hasMoreBelow
          ? <Text color={pickerColors.separatorColor}>…</Text>
          : null}
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      marginLeft={marginLeft}
      marginTop={marginTop}
      marginBottom={marginBottom}
      width={panelWidth}
      borderStyle="round"
      borderColor={pickerColors.borderColor}
      paddingX={1}
    >
      {/* Loading indicator */}
      {isLoading && items.length === 0 && (
        <Text color={pickerColors.previewColor} dimColor>Searching...</Text>
      )}

      {/* Scroll up indicator */}
      {hasMoreAbove ? <Text color={pickerColors.separatorColor}>…</Text> : null}

      {/* Visible items - GENERIC rendering via getRenderSpec() */}
      {visibleItems.map((item, i) => {
        const isSelected = scrollWindow.start + i === selectedIndex;
        const spec = item.getRenderSpec();
        return (
          <GenericItem
            key={item.id}
            spec={spec}
            pickerColors={pickerColors}
            isSelected={isSelected}
            width={innerWidth}
          />
        );
      })}

      {/* Empty padding rows for fixed height (prevents shaking) */}
      {Array.from(
        { length: paddingCount },
        (_, i) => (
          <React.Fragment key={`pad-${i}`}>
            <Text>{" "}</Text>
          </React.Fragment>
        ),
      )}

      {/* Scroll down indicator */}
      {hasMoreBelow ? <Text color={pickerColors.separatorColor}>…</Text> : null}

      {items.length > 0 && (
        <Box marginTop={1}>
          <Text color={pickerColors.hintColor}>{helpText}</Text>
        </Box>
      )}

      {previewLines.map((line: string, index: number) => (
        <React.Fragment key={`${selectedItem?.id ?? "doc"}-${index}`}>
          <Text color={pickerColors.previewColor}>{line}</Text>
        </React.Fragment>
      ))}
      {showDocPanel && !extendedDoc && (
        <Text color={pickerColors.emptyColor}>
          (no documentation available)
        </Text>
      )}
    </Box>
  );
}

// ============================================================
// Exports
// ============================================================
