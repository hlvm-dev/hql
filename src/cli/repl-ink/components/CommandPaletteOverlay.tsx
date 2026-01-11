/**
 * Command Palette with True Floating Overlay
 *
 * OpenCode-style command palette that floats on top of existing content
 * using raw ANSI escape codes for absolute positioning.
 *
 * Features:
 * - True floating overlay (doesn't push content down)
 * - Blinking cursor in search field (macOS-style)
 * - Theme-aware colors
 * - Optimized rendering (cursor-only updates for blink)
 */

import React, { useState, useMemo, useEffect, useCallback, useRef } from "npm:react@18";
import { useInput } from "npm:ink@5";
import { registry, getDisplay, CATEGORY_ORDER } from "../keybindings/index.ts";
import type { KeybindingAction, KeybindingMatch, KeybindingCategory } from "../keybindings/index.ts";
import {
  clearOverlay,
  getTerminalSize,
  ansi,
  hexToRgb,
} from "../overlay/index.ts";
import { useTheme } from "../../theme/index.ts";

// ============================================================
// Types
// ============================================================

interface CommandPaletteOverlayProps {
  onClose: () => void;
  onExecute: (action: KeybindingAction) => void;
}

/** Flattened item for rendering */
interface FlatItem {
  type: "category" | "item" | "spacer";
  category?: KeybindingCategory;
  match?: KeybindingMatch;
}

// ============================================================
// Constants
// ============================================================

const PALETTE_WIDTH = 58;      // Wider like OpenCode
const PALETTE_HEIGHT = 24;     // Taller to show more items
const PADDING_TOP = 2;
const PADDING_BOTTOM = 2;
const PADDING_LEFT = 4;
const PADDING_RIGHT = 4;
const CONTENT_START = PADDING_TOP + 4; // header + space + search + 2 spaces
const VISIBLE_ROWS = PALETTE_HEIGHT - CONTENT_START - PADDING_BOTTOM;
const BG_COLOR: [number, number, number] = [35, 35, 40];

// Cursor blink timing (macOS standard)
const CURSOR_BLINK_MS = 530;

// Shared encoder
const encoder = new TextEncoder();

// ============================================================
// Helpers
// ============================================================

/** Calculate centered position (both horizontally and vertically) */
function getOverlayPosition(): { x: number; y: number } {
  const term = getTerminalSize();
  // Center horizontally and vertically, with minimum margins
  const x = Math.max(2, Math.floor((term.columns - PALETTE_WIDTH) / 2));
  const y = Math.max(2, Math.floor((term.rows - PALETTE_HEIGHT) / 2));
  return { x, y };
}

// ============================================================
// Component
// ============================================================

export function CommandPaletteOverlay({
  onClose,
  onExecute,
}: CommandPaletteOverlayProps): React.ReactElement | null {
  const { theme } = useTheme();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);
  const overlayPosRef = useRef({ x: 0, y: 0 });
  const isFirstRender = useRef(true);

  // Theme-aware colors
  const highlightColor = hexToRgb(theme.warning);
  const categoryColor = hexToRgb(theme.accent);
  const primaryColor = hexToRgb(theme.primary);
  const mutedColor = hexToRgb(theme.muted);

  const bgStyle = useMemo(() =>
    ansi.bg(BG_COLOR[0], BG_COLOR[1], BG_COLOR[2]),
    []
  );

  // Search with fuzzy matching
  const results = useMemo(() => registry.search(query), [query]);

  // Build flat list with category headers and spacers
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
        // Add spacer before category (except first)
        if (!isFirst) {
          list.push({ type: "spacer" });
        }
        isFirst = false;
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
      // Scroll up - show category header and spacer if present
      let newOffset = posInList;
      const prevItem = flatList[posInList - 1];
      if (prevItem?.type === "category") {
        newOffset = posInList - 1;
        // Also show spacer before category
        const spacerItem = flatList[posInList - 2];
        if (spacerItem?.type === "spacer") {
          newOffset = posInList - 2;
        }
      }
      setScrollOffset(Math.max(0, newOffset));
    } else if (posInList >= visibleEnd) {
      setScrollOffset(posInList - VISIBLE_ROWS + 1);
    }
  }, [selectedIndex, selectableItems, flatList, scrollOffset]);

  // Draw cursor only (optimized for blink)
  const drawCursor = useCallback(() => {
    const pos = overlayPosRef.current;
    if (pos.x === 0 && pos.y === 0) return; // Not positioned yet

    const searchY = pos.y + PADDING_TOP + 2;
    const cursorX = pos.x + PADDING_LEFT + query.length;

    let output = ansi.cursorSave + ansi.cursorHide;
    output += ansi.cursorTo(cursorX, searchY);
    output += bgStyle;

    if (cursorVisible) {
      output += ansi.inverse + " " + ansi.reset;
    } else {
      output += " ";
    }

    output += ansi.cursorRestore + ansi.cursorShow;
    Deno.stdout.writeSync(encoder.encode(output));
  }, [query.length, cursorVisible, bgStyle]);

  // Draw full palette
  const drawPalette = useCallback(() => {
    const pos = getOverlayPosition();
    overlayPosRef.current = pos;

    let output = "";
    output += ansi.cursorSave;
    output += ansi.cursorHide;

    // === Top padding rows ===
    for (let i = 0; i < PADDING_TOP; i++) {
      output += ansi.cursorTo(pos.x, pos.y + i);
      output += bgStyle + " ".repeat(PALETTE_WIDTH);
    }

    // === Header row ===
    const headerY = pos.y + PADDING_TOP;
    output += ansi.cursorTo(pos.x, headerY);
    output += bgStyle;
    output += " ".repeat(PADDING_LEFT);
    output += ansi.fg(primaryColor[0], primaryColor[1], primaryColor[2]);
    output += ansi.bold + "Commands" + ansi.reset + bgStyle;
    const escText = "esc";
    const headerContentWidth = PALETTE_WIDTH - PADDING_LEFT - PADDING_RIGHT;
    const headerPad = headerContentWidth - 8 - escText.length;
    output += " ".repeat(headerPad);
    output += ansi.fg(mutedColor[0], mutedColor[1], mutedColor[2]);
    output += escText + ansi.reset + bgStyle;
    output += " ".repeat(PADDING_RIGHT);

    // === Empty row after header ===
    output += ansi.cursorTo(pos.x, headerY + 1);
    output += bgStyle + " ".repeat(PALETTE_WIDTH);

    // === Search input row ===
    const searchY = headerY + 2;
    output += ansi.cursorTo(pos.x, searchY);
    output += bgStyle;
    output += " ".repeat(PADDING_LEFT);

    const searchWidth = PALETTE_WIDTH - PADDING_LEFT - PADDING_RIGHT;
    if (query) {
      const displayQuery = query.slice(0, searchWidth - 2);
      output += displayQuery;
      // Cursor (will be updated by drawCursor)
      if (cursorVisible) {
        output += ansi.inverse + " " + ansi.reset + bgStyle;
      } else {
        output += " ";
      }
      output += " ".repeat(Math.max(0, searchWidth - displayQuery.length - 1));
    } else {
      output += ansi.fg(mutedColor[0], mutedColor[1], mutedColor[2]);
      if (cursorVisible) {
        output += ansi.inverse + "S" + ansi.reset + bgStyle;
        output += ansi.fg(mutedColor[0], mutedColor[1], mutedColor[2]);
        output += "earch";
      } else {
        output += "Search";
      }
      output += ansi.reset + bgStyle;
      output += " ".repeat(searchWidth - 6);
    }
    output += " ".repeat(PADDING_RIGHT);

    // === Two empty rows after search (more spacing) ===
    output += ansi.cursorTo(pos.x, searchY + 1);
    output += bgStyle + " ".repeat(PALETTE_WIDTH);
    output += ansi.cursorTo(pos.x, searchY + 2);
    output += bgStyle + " ".repeat(PALETTE_WIDTH);

    // === Content rows ===
    const visibleList = flatList.slice(scrollOffset, scrollOffset + VISIBLE_ROWS);
    let contentRow = 0;

    for (const item of visibleList) {
      output += ansi.cursorTo(pos.x, pos.y + CONTENT_START + contentRow);
      output += bgStyle;

      if (item.type === "spacer") {
        // Empty spacer row for visual separation
        output += " ".repeat(PALETTE_WIDTH);
      } else if (item.type === "category") {
        output += " ".repeat(PADDING_LEFT);
        output += ansi.fg(categoryColor[0], categoryColor[1], categoryColor[2]);
        output += ansi.bold;
        const catText = item.category!.slice(0, PALETTE_WIDTH - PADDING_LEFT - PADDING_RIGHT);
        output += catText;
        output += ansi.reset + bgStyle;
        output += " ".repeat(PALETTE_WIDTH - PADDING_LEFT - catText.length);
      } else {
        const match = item.match!;
        const globalIdx = selectableItems.indexOf(item as FlatItem & { match: KeybindingMatch });
        const isSelected = globalIdx === selectedIndex;
        const kb = match.keybinding;
        const display = getDisplay(kb);

        if (isSelected) {
          output += ansi.bg(highlightColor[0], highlightColor[1], highlightColor[2]);
          output += ansi.fg(30, 30, 30);
        }

        output += " ".repeat(PADDING_LEFT - 2);
        output += isSelected ? "▸ " : "  ";

        const contentWidth = PALETTE_WIDTH - PADDING_LEFT - PADDING_RIGHT;
        const maxLabelLen = contentWidth - 14;
        const label = kb.label.slice(0, maxLabelLen);
        output += label;

        const shortcut = display.slice(0, 12);
        const padLen = contentWidth - label.length - shortcut.length;
        output += " ".repeat(Math.max(1, padLen));

        if (!isSelected) {
          output += ansi.fg(mutedColor[0], mutedColor[1], mutedColor[2]);
        }
        output += shortcut;
        output += ansi.reset + bgStyle;
        output += " ".repeat(PADDING_RIGHT);
      }

      contentRow++;
    }

    // Fill remaining content rows
    while (contentRow < VISIBLE_ROWS) {
      output += ansi.cursorTo(pos.x, pos.y + CONTENT_START + contentRow);
      output += bgStyle + " ".repeat(PALETTE_WIDTH);
      contentRow++;
    }

    // === Bottom padding ===
    const footerStartY = pos.y + CONTENT_START + VISIBLE_ROWS;
    for (let i = 0; i < PADDING_BOTTOM - 1; i++) {
      output += ansi.cursorTo(pos.x, footerStartY + i);
      output += bgStyle + " ".repeat(PALETTE_WIDTH);
    }

    // === Footer row ===
    const footerY = pos.y + PALETTE_HEIGHT - 1;
    output += ansi.cursorTo(pos.x, footerY);
    output += bgStyle;

    const posText = selectableItems.length > 0
      ? `${selectedIndex + 1}/${selectableItems.length}`
      : "";
    output += " ".repeat(PALETTE_WIDTH - posText.length - PADDING_RIGHT);
    output += ansi.fg(mutedColor[0], mutedColor[1], mutedColor[2]);
    output += posText;
    output += ansi.reset + bgStyle;
    output += " ".repeat(PADDING_RIGHT);

    output += ansi.reset;
    output += ansi.cursorRestore;
    output += ansi.cursorShow;

    Deno.stdout.writeSync(encoder.encode(output));
  }, [query, cursorVisible, flatList, selectableItems, selectedIndex, scrollOffset,
      highlightColor, categoryColor, primaryColor, mutedColor, bgStyle]);

  // Cursor blink effect - only redraws cursor, not full palette
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorVisible((v: boolean) => !v);
    }, CURSOR_BLINK_MS);
    return () => clearInterval(interval);
  }, []);

  // Cursor-only redraw on blink (after first full render)
  useEffect(() => {
    if (isFirstRender.current) return;
    drawCursor();
  }, [cursorVisible, drawCursor]);

  // Full palette draw on content changes
  useEffect(() => {
    drawPalette();
    isFirstRender.current = false;
  }, [query, selectedIndex, scrollOffset, flatList]);

  // Reset cursor visibility when typing
  useEffect(() => {
    setCursorVisible(true);
  }, [query]);

  // Clear overlay on unmount
  useEffect(() => {
    return () => {
      const pos = overlayPosRef.current;
      if (pos.x !== 0 || pos.y !== 0) {
        clearOverlay({
          x: pos.x,
          y: pos.y,
          width: PALETTE_WIDTH,
          height: PALETTE_HEIGHT,
        });
      }
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
        return;
      }
      onExecute(action);
      onClose();
      return;
    }

    if (key.upArrow || (key.ctrl && input === "p")) {
      if (selectableItems.length === 0) return;
      setSelectedIndex((i: number) => (i <= 0 ? selectableItems.length - 1 : i - 1));
      return;
    }

    if (key.downArrow || (key.ctrl && input === "n")) {
      if (selectableItems.length === 0) return;
      setSelectedIndex((i: number) => (i >= selectableItems.length - 1 ? 0 : i + 1));
      return;
    }

    if (key.pageUp) {
      if (selectableItems.length === 0) return;
      setSelectedIndex((i: number) => Math.max(0, i - VISIBLE_ROWS));
      return;
    }

    if (key.pageDown) {
      if (selectableItems.length === 0) return;
      setSelectedIndex((i: number) => Math.min(selectableItems.length - 1, i + VISIBLE_ROWS));
      return;
    }

    if (key.backspace || key.delete) {
      setQuery((q: string) => q.slice(0, -1));
      return;
    }

    if (input && !key.ctrl && !key.meta && input.length === 1) {
      setQuery((q: string) => q + input);
    }
  });

  return null;
}
