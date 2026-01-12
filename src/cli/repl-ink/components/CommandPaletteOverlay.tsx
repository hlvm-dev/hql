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
import { handleTextEditingKey } from "../utils/text-editing.ts";

// ============================================================
// Types
// ============================================================

/** Persistent palette state that survives open/close */
export interface PaletteState {
  query: string;
  cursorPos: number;
  selectedIndex: number;
  scrollOffset: number;
}

/** Key combination for rebinding */
export interface KeyCombo {
  key: string;       // The main key (e.g., "a", "ArrowUp", "Enter")
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
}

interface CommandPaletteOverlayProps {
  onClose: () => void;
  onExecute: (action: KeybindingAction) => void;
  /** Initial state from previous session */
  initialState?: PaletteState;
  /** Called when state changes (for persistence) */
  onStateChange?: (state: PaletteState) => void;
  /** Called when user rebinds a keybinding */
  onRebind?: (keybindingId: string, newCombo: KeyCombo) => void;
}

/** Flattened item for rendering - discriminated union for type safety */
type FlatItem =
  | { type: "category"; category: KeybindingCategory }
  | { type: "item"; match: KeybindingMatch }
  | { type: "spacer" };

type RGB = [number, number, number];

// ============================================================
// Layout Constants
// ============================================================

const PALETTE_WIDTH = 58;
const PALETTE_HEIGHT = 24;
const PADDING = { top: 2, bottom: 2, left: 4, right: 4 };
const HEADER_ROWS = 4;  // header + empty + search + empty
const CONTENT_START = PADDING.top + HEADER_ROWS;
const VISIBLE_ROWS = PALETTE_HEIGHT - CONTENT_START - PADDING.bottom;
const BG_COLOR: RGB = [35, 35, 40];

// Cursor blink timing (macOS standard)
const CURSOR_BLINK_MS = 530;

// Shared encoder for terminal output
const encoder = new TextEncoder();

// ============================================================
// Helpers
// ============================================================

/** Calculate centered position */
function getOverlayPosition(): { x: number; y: number } {
  const term = getTerminalSize();
  return {
    x: Math.max(2, Math.floor((term.columns - PALETTE_WIDTH) / 2)),
    y: Math.max(2, Math.floor((term.rows - PALETTE_HEIGHT) / 2)),
  };
}

/** Build flat list with category headers and spacers for rendering */
function buildFlatList(results: KeybindingMatch[]): FlatItem[] {
  // Group results by category
  const byCategory = new Map<KeybindingCategory, KeybindingMatch[]>();
  for (const match of results) {
    const cat = match.keybinding.category;
    const items = byCategory.get(cat) ?? [];
    items.push(match);
    byCategory.set(cat, items);
  }

  // Build flat list with proper spacing:
  // Category → Spacer → Items (for each non-empty category)
  const list: FlatItem[] = [];
  let isFirst = true;

  for (const category of CATEGORY_ORDER) {
    const items = byCategory.get(category);
    if (!items?.length) continue;

    // Add separator before category (except first)
    if (!isFirst) {
      list.push({ type: "spacer" });
    }
    isFirst = false;

    // Category header
    list.push({ type: "category", category });

    // Spacer after category header for visual breathing room
    list.push({ type: "spacer" });

    // Items
    for (const match of items) {
      list.push({ type: "item", match });
    }
  }

  return list;
}

/** Get only selectable items from flat list */
function getSelectableItems(flatList: FlatItem[]): Array<FlatItem & { type: "item" }> {
  return flatList.filter((item): item is FlatItem & { type: "item" } =>
    item.type === "item"
  );
}

/** Create ANSI foreground color string from RGB */
function fg(rgb: RGB): string {
  return ansi.fg(rgb[0], rgb[1], rgb[2]);
}

/** Create ANSI background color string from RGB */
function bg(rgb: RGB): string {
  return ansi.bg(rgb[0], rgb[1], rgb[2]);
}

// ============================================================
// Component
// ============================================================

export function CommandPaletteOverlay({
  onClose,
  onExecute,
  initialState,
  onStateChange,
  onRebind,
}: CommandPaletteOverlayProps): React.ReactElement | null {
  const { theme } = useTheme();
  // Initialize state from props (persistent across open/close)
  const [query, setQuery] = useState(initialState?.query ?? "");
  const [cursorPos, setCursorPos] = useState(initialState?.cursorPos ?? 0);
  const [selectedIndex, setSelectedIndex] = useState(initialState?.selectedIndex ?? 0);
  const [scrollOffset, setScrollOffset] = useState(initialState?.scrollOffset ?? 0);
  const [cursorVisible, setCursorVisible] = useState(true);
  const overlayPosRef = useRef({ x: 0, y: 0 });
  const isFirstRender = useRef(true);
  const hasInitialized = useRef(false);
  const prevQueryRef = useRef(query);

  // Rebind mode: waiting for user to press new key combo
  const [rebindMode, setRebindMode] = useState(false);
  const [rebindingId, setRebindingId] = useState<string | null>(null);

  // Theme colors (memoized)
  const colors = useMemo(() => ({
    highlight: hexToRgb(theme.warning) as RGB,
    category: hexToRgb(theme.accent) as RGB,
    primary: hexToRgb(theme.primary) as RGB,
    muted: hexToRgb(theme.muted) as RGB,
    bgStyle: bg(BG_COLOR),
  }), [theme]);

  // Search results and derived data
  const results = useMemo(() => registry.search(query), [query]);
  const flatList = useMemo(() => buildFlatList(results), [results]);
  const selectableItems = useMemo(() => getSelectableItems(flatList), [flatList]);

  // Reset selection ONLY when query actually changes (not on mount with initialState)
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      prevQueryRef.current = query;
      return;
    }
    // Only reset if query actually changed
    if (prevQueryRef.current !== query) {
      prevQueryRef.current = query;
      setSelectedIndex(0);
      setScrollOffset(0);
    }
  }, [query]);

  // Report state changes for persistence
  useEffect(() => {
    onStateChange?.({ query, cursorPos, selectedIndex, scrollOffset });
  }, [query, cursorPos, selectedIndex, scrollOffset, onStateChange]);

  // Auto-scroll to keep selection visible
  useEffect(() => {
    const selectedItem = selectableItems[selectedIndex];
    if (!selectedItem) return;

    const posInList = flatList.indexOf(selectedItem);
    if (posInList === -1) return;

    const visibleEnd = scrollOffset + VISIBLE_ROWS;

    if (posInList < scrollOffset) {
      // Scroll up - include category header and spacers
      let newOffset = posInList;
      for (let i = posInList - 1; i >= 0 && i >= posInList - 3; i--) {
        const item = flatList[i];
        if (item.type === "category" || item.type === "spacer") {
          newOffset = i;
        } else {
          break;
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
    if (pos.x === 0 && pos.y === 0) return;

    const searchY = pos.y + PADDING.top + 2;
    const cursorX = pos.x + PADDING.left + cursorPos;

    const charAtCursor = query[cursorPos] || " ";
    const cursorStyle = cursorVisible
      ? ansi.inverse + charAtCursor + ansi.reset
      : charAtCursor;

    const output = ansi.cursorSave + ansi.cursorHide
      + ansi.cursorTo(cursorX, searchY)
      + colors.bgStyle + cursorStyle
      + ansi.cursorRestore + ansi.cursorShow;

    Deno.stdout.writeSync(encoder.encode(output));
  }, [query, cursorPos, cursorVisible, colors.bgStyle]);

  // Draw full palette
  const drawPalette = useCallback(() => {
    const pos = getOverlayPosition();
    overlayPosRef.current = pos;

    const contentWidth = PALETTE_WIDTH - PADDING.left - PADDING.right;
    const bgStyle = colors.bgStyle;
    let output = ansi.cursorSave + ansi.cursorHide;

    // Helper: draw empty row
    const drawEmptyRow = (y: number) => {
      output += ansi.cursorTo(pos.x, y) + bgStyle + " ".repeat(PALETTE_WIDTH);
    };

    // === Top padding ===
    for (let i = 0; i < PADDING.top; i++) {
      drawEmptyRow(pos.y + i);
    }

    // === Header row ===
    const headerY = pos.y + PADDING.top;
    const title = "Commands";
    const escHint = "esc";
    const headerPad = contentWidth - title.length - escHint.length;

    output += ansi.cursorTo(pos.x, headerY) + bgStyle;
    output += " ".repeat(PADDING.left);
    output += fg(colors.primary) + ansi.bold + title + ansi.reset + bgStyle;
    output += " ".repeat(headerPad);
    output += fg(colors.muted) + escHint + ansi.reset + bgStyle;
    output += " ".repeat(PADDING.right);

    // === Empty row after header ===
    drawEmptyRow(headerY + 1);

    // === Search input row ===
    const searchY = headerY + 2;
    output += ansi.cursorTo(pos.x, searchY) + bgStyle;
    output += " ".repeat(PADDING.left);

    if (rebindMode) {
      // Rebind mode: show "Press new key..." with blinking cursor
      const rebindText = "Press new key combo...";
      output += fg(colors.highlight);
      output += cursorVisible
        ? ansi.inverse + rebindText[0] + ansi.reset + bgStyle + fg(colors.highlight) + rebindText.slice(1)
        : rebindText;
      output += ansi.reset + bgStyle;
      output += " ".repeat(contentWidth - rebindText.length);
    } else if (query) {
      const displayQuery = query.slice(0, contentWidth - 2);
      const displayCursorPos = Math.min(cursorPos, displayQuery.length);

      output += displayQuery.slice(0, displayCursorPos);

      const charAtCursor = displayQuery[displayCursorPos] || " ";
      output += cursorVisible
        ? ansi.inverse + charAtCursor + ansi.reset + bgStyle
        : charAtCursor;

      output += displayQuery.slice(displayCursorPos + 1);
      output += " ".repeat(Math.max(0, contentWidth - displayQuery.length - 1));
    } else {
      // Placeholder with cursor
      output += fg(colors.muted);
      output += cursorVisible
        ? ansi.inverse + "S" + ansi.reset + bgStyle + fg(colors.muted) + "earch"
        : "Search";
      output += ansi.reset + bgStyle;
      output += " ".repeat(contentWidth - 6);
    }
    output += " ".repeat(PADDING.right);

    // === Empty row after search ===
    drawEmptyRow(searchY + 1);

    // === Content rows ===
    const visibleList = flatList.slice(scrollOffset, scrollOffset + VISIBLE_ROWS);

    for (let row = 0; row < VISIBLE_ROWS; row++) {
      const rowY = pos.y + CONTENT_START + row;
      const item = visibleList[row];

      output += ansi.cursorTo(pos.x, rowY) + bgStyle;

      if (!item) {
        // Empty row
        output += " ".repeat(PALETTE_WIDTH);
      } else if (item.type === "spacer") {
        // Spacer row
        output += " ".repeat(PALETTE_WIDTH);
      } else if (item.type === "category") {
        // Category header
        output += " ".repeat(PADDING.left);
        output += fg(colors.category) + ansi.bold;
        const catText = item.category.slice(0, contentWidth);
        output += catText;
        output += ansi.reset + bgStyle;
        output += " ".repeat(PALETTE_WIDTH - PADDING.left - catText.length);
      } else {
        // Item row
        const { match } = item;
        const globalIdx = selectableItems.indexOf(item);
        const isSelected = globalIdx === selectedIndex;
        const kb = match.keybinding;
        const display = getDisplay(kb);
        const isInfoOnly = kb.action.type === "INFO";

        if (isSelected) {
          output += bg(colors.highlight) + ansi.fg(30, 30, 30);
        }

        output += " ".repeat(PADDING.left - 2);
        // Show different indicator: ▸ for executable, ⌨ for info-only (keyboard shortcut reference)
        if (isSelected) {
          output += isInfoOnly ? "⌨ " : "▸ ";
        } else {
          output += isInfoOnly ? "⌨ " : "  ";
        }

        const maxLabelLen = contentWidth - 14;
        const label = kb.label.slice(0, maxLabelLen);
        // Dim INFO items slightly when not selected
        if (isInfoOnly && !isSelected) {
          output += fg(colors.muted);
        }
        output += label;
        if (isInfoOnly && !isSelected) {
          output += ansi.reset + bgStyle;
        }

        const shortcut = display.slice(0, 12);
        const padLen = contentWidth - label.length - shortcut.length;
        output += " ".repeat(Math.max(1, padLen));

        if (!isSelected) {
          output += fg(colors.muted);
        }
        output += shortcut;
        output += ansi.reset + bgStyle;
        output += " ".repeat(PADDING.right);
      }
    }

    // === Bottom padding ===
    const footerStartY = pos.y + CONTENT_START + VISIBLE_ROWS;
    for (let i = 0; i < PADDING.bottom - 1; i++) {
      drawEmptyRow(footerStartY + i);
    }

    // === Footer row ===
    const footerY = pos.y + PALETTE_HEIGHT - 1;
    // Show different hints based on mode
    const hintText = rebindMode
      ? "esc=cancel"
      : onRebind
        ? "tab=rebind ⌨=shortcut"
        : "⌨=shortcut only";
    const posText = selectableItems.length > 0
      ? `${selectedIndex + 1}/${selectableItems.length}`
      : "";

    output += ansi.cursorTo(pos.x, footerY) + bgStyle;
    output += " ".repeat(PADDING.left);
    output += fg(colors.muted) + hintText;
    const middlePad = PALETTE_WIDTH - PADDING.left - hintText.length - posText.length - PADDING.right;
    output += " ".repeat(Math.max(1, middlePad));
    output += posText + ansi.reset + bgStyle;
    output += " ".repeat(PADDING.right);

    output += ansi.reset + ansi.cursorRestore + ansi.cursorShow;

    Deno.stdout.writeSync(encoder.encode(output));
  }, [query, cursorPos, cursorVisible, flatList, selectableItems, selectedIndex, scrollOffset, colors, rebindMode, onRebind]);

  // Cursor blink effect
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorVisible((v: boolean) => !v);
    }, CURSOR_BLINK_MS);
    return () => clearInterval(interval);
  }, []);

  // Cursor-only redraw on blink
  useEffect(() => {
    if (isFirstRender.current) return;
    drawCursor();
  }, [cursorVisible, drawCursor]);

  // Full palette draw on content changes
  useEffect(() => {
    drawPalette();
    isFirstRender.current = false;
  }, [query, cursorPos, selectedIndex, scrollOffset, flatList, drawPalette, rebindMode]);

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
    // ============================================================
    // REBIND MODE: Capture any key combo and save as new binding
    // ============================================================
    if (rebindMode && rebindingId) {
      // ESC cancels rebind mode
      if (key.escape) {
        setRebindMode(false);
        setRebindingId(null);
        return;
      }

      // Build key combo from key press
      const combo: KeyCombo = {
        key: input || (key.return ? "Enter" : key.tab ? "Tab" :
              key.upArrow ? "ArrowUp" : key.downArrow ? "ArrowDown" :
              key.leftArrow ? "ArrowLeft" : key.rightArrow ? "ArrowRight" :
              key.backspace ? "Backspace" : key.delete ? "Delete" :
              key.pageUp ? "PageUp" : key.pageDown ? "PageDown" : "unknown"),
        ctrl: key.ctrl,
        meta: key.meta,
        alt: key.escape,  // Option/Alt on macOS sends escape
        shift: key.shift,
      };

      // Call onRebind callback if provided
      if (onRebind) {
        onRebind(rebindingId, combo);
      }

      // Exit rebind mode
      setRebindMode(false);
      setRebindingId(null);
      return;
    }

    // ============================================================
    // NORMAL MODE
    // ============================================================
    if (key.escape) {
      onClose();
      return;
    }

    if (key.return && selectableItems[selectedIndex]) {
      const action = selectableItems[selectedIndex].match.keybinding.action;
      if (action.type === "INFO") {
        // INFO items are display-only (shortcuts) - just close palette
        // User saw the shortcut and can now use it directly
        onClose();
        return;
      }
      onExecute(action);
      onClose();
      return;
    }

    // Tab: Enter rebind mode for selected item (if onRebind is available)
    if (key.tab && selectableItems[selectedIndex] && onRebind) {
      const kb = selectableItems[selectedIndex].match.keybinding;
      setRebindMode(true);
      setRebindingId(kb.id);
      return;
    }

    // List navigation
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

    // Text editing
    const result = handleTextEditingKey(input, key, query, cursorPos);
    if (result) {
      setQuery(result.value);
      setCursorPos(result.cursor);
    }
  });

  return null;
}
