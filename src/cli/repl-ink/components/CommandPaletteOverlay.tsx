/**
 * Command Palette with True Floating Overlay
 *
 * OpenCode-style command palette that floats on top of existing content
 * using raw ANSI escape codes for absolute positioning.
 *
 * Unlike the regular Ink-based CommandPalette, this one:
 * - Draws directly on top of terminal content
 * - Doesn't push existing content down
 * - Appears centered like a true modal
 */

import React, { useState, useMemo, useEffect, useCallback } from "npm:react@18";
import { useInput, useApp } from "npm:ink@5";
import { registry, getDisplay, CATEGORY_ORDER } from "../keybindings/index.ts";
import type { KeybindingAction, KeybindingMatch, KeybindingCategory } from "../keybindings/index.ts";
import {
  drawOverlay,
  clearOverlay,
  centerOverlay,
  getTerminalSize,
  ansi,
  box,
  type OverlayLine,
} from "../overlay/index.ts";

// ============================================================
// Types
// ============================================================

interface CommandPaletteOverlayProps {
  onClose: () => void;
  onExecute: (action: KeybindingAction) => void;
}

/** Flattened item for rendering */
interface FlatItem {
  type: "category" | "item";
  category: KeybindingCategory;
  match?: KeybindingMatch;
}

// ============================================================
// Constants
// ============================================================

const PALETTE_WIDTH = 60;
const PALETTE_HEIGHT = 20;
const VISIBLE_ROWS = PALETTE_HEIGHT - 4; // Account for border, header, search, footer
const BORDER_COLOR: [number, number, number] = [100, 149, 237]; // Cornflower blue
const BG_COLOR: [number, number, number] = [25, 25, 35];
const HIGHLIGHT_COLOR: [number, number, number] = [70, 130, 180]; // Steel blue

// ============================================================
// Component
// ============================================================

export function CommandPaletteOverlay({
  onClose,
  onExecute,
}: CommandPaletteOverlayProps): React.ReactElement | null {
  const { exit } = useApp();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Search with fuzzy matching
  const results = useMemo(() => registry.search(query), [query]);

  // Build flat list with category headers
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

    for (const cat of CATEGORY_ORDER) {
      const items = byCategory.get(cat);
      if (items && items.length > 0) {
        list.push({ type: "category", category: cat });
        for (const match of items) {
          list.push({ type: "item", category: cat, match });
        }
      }
    }
    return list;
  }, [results]);

  // Get only selectable items
  const selectableItems = useMemo(() =>
    flatList.filter((item: FlatItem): item is FlatItem & { match: KeybindingMatch } =>
      item.type === "item"
    ),
    [flatList]
  );

  // Reset on query change
  useEffect(() => {
    setSelectedIndex(0);
    setScrollOffset(0);
  }, [query]);

  // Auto-scroll to keep selection visible
  useEffect(() => {
    const selectedItem = selectableItems[selectedIndex];
    if (!selectedItem) return;

    const posInList = flatList.indexOf(selectedItem);
    if (posInList === -1) return;

    const visibleEnd = scrollOffset + VISIBLE_ROWS;

    if (posInList < scrollOffset) {
      const prevItem = flatList[posInList - 1];
      if (prevItem?.type === "category") {
        setScrollOffset(posInList - 1);
      } else {
        setScrollOffset(posInList);
      }
    } else if (posInList >= visibleEnd) {
      setScrollOffset(posInList - VISIBLE_ROWS + 1);
    }
  }, [selectedIndex, selectableItems, flatList, scrollOffset]);

  // Draw the overlay
  const drawPalette = useCallback(() => {
    const term = getTerminalSize();
    const pos = centerOverlay(PALETTE_WIDTH, PALETTE_HEIGHT);

    // Build lines to render
    const lines: OverlayLine[] = [];

    // Search input line
    const searchText = query
      ? `  ${query}█`
      : `  ${ansi.dim}Type to search...${ansi.reset}`;
    lines.push({ text: searchText });

    // Empty line after search
    lines.push({ text: "" });

    // Visible portion of the list
    const visibleList = flatList.slice(scrollOffset, scrollOffset + VISIBLE_ROWS);

    for (const item of visibleList) {
      if (item.type === "category") {
        // Category header
        lines.push({
          text: `  ${item.category}`,
          bold: true,
          color: [255, 200, 100], // Gold color for categories
        });
      } else {
        // Item row
        const match = item.match!;
        const globalIdx = selectableItems.indexOf(item as FlatItem & { match: KeybindingMatch });
        const isSelected = globalIdx === selectedIndex;
        const kb = match.keybinding;
        const display = getDisplay(kb);

        // Format: "  > Label                      Ctrl+X"
        const prefix = isSelected ? " ▸ " : "   ";
        const label = kb.label.slice(0, PALETTE_WIDTH - 20);
        const shortcut = display.slice(0, 15);
        const padding = PALETTE_WIDTH - 4 - label.length - shortcut.length;

        lines.push({
          text: `${prefix}${label}${" ".repeat(Math.max(1, padding))}${shortcut}`,
          selected: isSelected,
          color: isSelected ? [255, 255, 255] : undefined,
        });
      }
    }

    // Scroll indicators
    const canScrollUp = scrollOffset > 0;
    const canScrollDown = scrollOffset + VISIBLE_ROWS < flatList.length;

    // Fill remaining space
    while (lines.length < VISIBLE_ROWS + 2) {
      lines.push({ text: "" });
    }

    // Calculate position counter
    const posText = selectableItems.length > 0
      ? `${selectedIndex + 1}/${selectableItems.length}`
      : "0/0";
    const scrollHint = canScrollUp || canScrollDown
      ? (canScrollUp && canScrollDown ? "↑↓" : canScrollUp ? "↑" : "↓")
      : "";
    const footer = `${scrollHint} ${posText}`.trim();

    // Draw using our overlay system
    let output = "";

    // Save cursor and hide
    output += ansi.cursorSave;
    output += ansi.cursorHide;

    const innerWidth = PALETTE_WIDTH - 2;
    const borderStyle = ansi.fg(BORDER_COLOR[0], BORDER_COLOR[1], BORDER_COLOR[2]);
    const bgStyle = ansi.bg(BG_COLOR[0], BG_COLOR[1], BG_COLOR[2]);

    // Top border with title
    output += ansi.cursorTo(pos.x, pos.y);
    output += borderStyle;
    output += box.topLeft;
    const title = " Commands ";
    const titlePad = Math.floor((innerWidth - title.length) / 2);
    output += box.horizontal.repeat(titlePad);
    output += ansi.bold + title + ansi.reset + borderStyle;
    output += box.horizontal.repeat(innerWidth - titlePad - title.length);
    output += box.topRight;

    // Content lines
    for (let i = 0; i < lines.length && i < PALETTE_HEIGHT - 2; i++) {
      output += ansi.cursorTo(pos.x, pos.y + 1 + i);
      output += borderStyle + box.vertical + ansi.reset;
      output += bgStyle;

      const line = lines[i];
      if (line.selected) {
        // Highlight background for selected item
        output += ansi.bg(HIGHLIGHT_COLOR[0], HIGHLIGHT_COLOR[1], HIGHLIGHT_COLOR[2]);
      }
      if (line.bold) output += ansi.bold;
      if (line.dim) output += ansi.dim;
      if (line.color) {
        output += ansi.fg(line.color[0], line.color[1], line.color[2]);
      }

      // Truncate/pad text
      const text = line.text.slice(0, innerWidth).padEnd(innerWidth);
      output += text;
      output += ansi.reset + borderStyle + box.vertical;
    }

    // Bottom border with footer
    output += ansi.cursorTo(pos.x, pos.y + PALETTE_HEIGHT - 1);
    output += borderStyle;
    output += box.bottomLeft;

    // Footer: "esc close" on left, position counter on right
    const leftFooter = " esc ";
    const rightFooter = ` ${footer} `;
    const footerPad = innerWidth - leftFooter.length - rightFooter.length;
    output += ansi.dim + leftFooter + ansi.reset + borderStyle;
    output += box.horizontal.repeat(Math.max(0, footerPad));
    output += ansi.dim + rightFooter + ansi.reset + borderStyle;
    output += box.bottomRight;

    // Restore cursor
    output += ansi.reset;
    output += ansi.cursorRestore;
    output += ansi.cursorShow;

    process.stdout.write(output);
  }, [query, flatList, selectableItems, selectedIndex, scrollOffset]);

  // Draw on every state change
  useEffect(() => {
    drawPalette();
  }, [drawPalette]);

  // Clear overlay on unmount
  useEffect(() => {
    return () => {
      const pos = centerOverlay(PALETTE_WIDTH, PALETTE_HEIGHT);
      clearOverlay({
        x: pos.x,
        y: pos.y,
        width: PALETTE_WIDTH,
        height: PALETTE_HEIGHT,
      });
    };
  }, []);

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

  // Return null - we're drawing directly to terminal, not through React
  return null;
}
