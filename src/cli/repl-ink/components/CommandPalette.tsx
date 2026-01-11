/**
 * Command Palette Component
 *
 * OpenCode-style searchable command palette with category grouping and scrolling.
 * Triggered by Ctrl+P, shows all keybindings with fuzzy search.
 */

import React, { useState, useMemo, useEffect } from "npm:react@18";
import { Box, Text, useInput } from "npm:ink@5";
import { registry, getDisplay, CATEGORY_ORDER } from "../keybindings/index.ts";
import type { KeybindingAction, KeybindingMatch, KeybindingCategory } from "../keybindings/index.ts";
import { useTheme } from "../../theme/index.ts";

// ============================================================
// Types
// ============================================================

interface CommandPaletteProps {
  onClose: () => void;
  onExecute: (action: KeybindingAction) => void;
}

/** Flattened item with category info for rendering */
interface FlatItem {
  type: "category" | "item";
  category: KeybindingCategory;
  match?: KeybindingMatch;
  isFirstCategory?: boolean;
}

// ============================================================
// Constants
// ============================================================

/** Number of visible rows in the scrollable area */
const VISIBLE_ROWS = 12;

// ============================================================
// Component
// ============================================================

export function CommandPalette({
  onClose,
  onExecute,
}: CommandPaletteProps): React.ReactElement {
  const { color } = useTheme();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Search with fuzzy matching
  const results = useMemo(() => registry.search(query), [query]);

  // Build flat list with category headers for rendering
  const flatList = useMemo((): FlatItem[] => {
    const list: FlatItem[] = [];
    const byCategory = new Map<KeybindingCategory, KeybindingMatch[]>();

    for (const r of results) {
      const cat = r.keybinding.category;
      if (!byCategory.has(cat)) {
        byCategory.set(cat, []);
      }
      byCategory.get(cat)!.push(r);
    }

    let isFirst = true;
    for (const cat of CATEGORY_ORDER) {
      const items = byCategory.get(cat);
      if (items && items.length > 0) {
        // Add category header
        list.push({ type: "category", category: cat, isFirstCategory: isFirst });
        isFirst = false;
        // Add items
        for (const match of items) {
          list.push({ type: "item", category: cat, match });
        }
      }
    }
    return list;
  }, [results]);

  // Get only selectable items (not category headers)
  const selectableItems = useMemo(() =>
    flatList.filter((item: FlatItem): item is FlatItem & { match: KeybindingMatch } => item.type === "item"),
    [flatList]
  );

  // Reset selection and scroll when query changes
  useEffect(() => {
    setSelectedIndex(0);
    setScrollOffset(0);
  }, [query]);

  // Auto-scroll to keep selection visible
  useEffect(() => {
    // Find the position of selected item in the full list
    const selectedItem = selectableItems[selectedIndex];
    if (!selectedItem) return;

    const posInList = flatList.indexOf(selectedItem);
    if (posInList === -1) return;

    // Calculate visible range
    const visibleEnd = scrollOffset + VISIBLE_ROWS;

    // Scroll up if selection is above visible area
    if (posInList < scrollOffset) {
      // Show category header if this is first item in category
      const prevItem = flatList[posInList - 1];
      if (prevItem?.type === "category") {
        setScrollOffset(posInList - 1);
      } else {
        setScrollOffset(posInList);
      }
    }
    // Scroll down if selection is below visible area
    else if (posInList >= visibleEnd) {
      setScrollOffset(posInList - VISIBLE_ROWS + 1);
    }
  }, [selectedIndex, selectableItems, flatList, scrollOffset]);

  // Keyboard handling
  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.return && selectableItems[selectedIndex]) {
      const action = selectableItems[selectedIndex].match.keybinding.action;
      if (action.type === "INFO") {
        return; // INFO items are reference-only
      }
      onExecute(action);
      onClose();
      return;
    }

    // Up arrow or Ctrl+P
    if (key.upArrow || (key.ctrl && input === "p")) {
      if (selectableItems.length === 0) return;
      setSelectedIndex((i: number) => (i <= 0 ? selectableItems.length - 1 : i - 1));
      return;
    }

    // Down arrow or Ctrl+N
    if (key.downArrow || (key.ctrl && input === "n")) {
      if (selectableItems.length === 0) return;
      setSelectedIndex((i: number) => (i >= selectableItems.length - 1 ? 0 : i + 1));
      return;
    }

    // Page Up
    if (key.pageUp) {
      if (selectableItems.length === 0) return;
      setSelectedIndex((i: number) => Math.max(0, i - VISIBLE_ROWS));
      return;
    }

    // Page Down
    if (key.pageDown) {
      if (selectableItems.length === 0) return;
      setSelectedIndex((i: number) => Math.min(selectableItems.length - 1, i + VISIBLE_ROWS));
      return;
    }

    // Backspace or Delete
    if (key.backspace || key.delete) {
      setQuery((q: string) => q.slice(0, -1));
      return;
    }

    // Regular typing
    if (input && !key.ctrl && !key.meta && input.length === 1) {
      setQuery((q: string) => q + input);
    }
  });

  // Calculate visible portion of flat list
  const visibleList = flatList.slice(scrollOffset, scrollOffset + VISIBLE_ROWS);
  const canScrollUp = scrollOffset > 0;
  const canScrollDown = scrollOffset + VISIBLE_ROWS < flatList.length;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color("primary")}
      paddingX={1}
      marginX={4}
    >
      {/* Header */}
      <Box paddingX={2} justifyContent="space-between">
        <Text bold>Commands</Text>
        <Text dimColor>esc</Text>
      </Box>

      {/* Search input */}
      <Box paddingX={2} paddingY={1}>
        <Text color={query ? undefined : "gray"}>
          {query || ""}
        </Text>
        <Text inverse color="gray">
          {query ? " " : "Search"}
        </Text>
      </Box>

      {/* Scroll up indicator */}
      {canScrollUp && (
        <Box paddingX={2}>
          <Text dimColor>▲ scroll up</Text>
        </Box>
      )}

      {/* Results */}
      {selectableItems.length === 0 ? (
        <Box paddingX={2} paddingY={1}>
          <Text dimColor>No results found</Text>
        </Box>
      ) : (
        visibleList.map((item: FlatItem, idx: number) => {
          if (item.type === "category") {
            return (
              <Box key={`cat-${item.category}`} paddingLeft={2} marginTop={item.isFirstCategory ? 0 : 1}>
                <Text bold color={color("accent")}>
                  {item.category}
                </Text>
              </Box>
            );
          }

          // Item row
          const match = item.match!;
          const globalIdx = selectableItems.indexOf(item as FlatItem & { match: KeybindingMatch });
          const isSelected = globalIdx === selectedIndex;
          const kb = match.keybinding;
          const display = getDisplay(kb);

          return (
            <Box
              key={kb.id}
              paddingX={1}
              backgroundColor={isSelected ? color("primary") : undefined}
            >
              <Box flexGrow={1}>
                <Text bold={isSelected} color={isSelected ? "black" : undefined}>
                  {isSelected ? "> " : "  "}
                  {kb.label}
                </Text>
              </Box>
              <Box flexShrink={0}>
                <Text color={isSelected ? "black" : "gray"} dimColor={!isSelected}>
                  {display}
                </Text>
              </Box>
            </Box>
          );
        })
      )}

      {/* Scroll down indicator */}
      {canScrollDown && (
        <Box paddingX={2}>
          <Text dimColor>▼ scroll down</Text>
        </Box>
      )}

      {/* Footer with count */}
      <Box paddingX={2} paddingTop={1} justifyContent="space-between">
        <Text dimColor>↑↓ navigate</Text>
        <Text dimColor>
          {selectableItems.length > 0
            ? `${selectedIndex + 1}/${selectableItems.length}`
            : "0/0"}
        </Text>
      </Box>
    </Box>
  );
}
