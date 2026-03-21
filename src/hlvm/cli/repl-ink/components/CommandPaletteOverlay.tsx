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

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useInput, useStdout } from "ink";
import {
  CATEGORY_ORDER,
  getDisplay,
  registry,
  type KeybindingAction,
  type KeybindingCategory,
  type KeybindingMatch,
} from "../keybindings/index.ts";
import {
  ansi,
  bg,
  clearOverlay,
  drawOverlayFrame,
  fg,
  OVERLAY_BG_COLOR,
  resolveOverlayFrame,
  shouldClearOverlay,
  themeToOverlayColors,
  writeToTerminal,
} from "../overlay/index.ts";
import { useTheme } from "../../theme/index.ts";
import { handleTextEditingKey } from "../utils/text-editing.ts";
import { CURSOR_BLINK_MS } from "../ui-constants.ts";
import { buildCursorWindowDisplay } from "../utils/cursor-window.ts";

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
  key: string; // The main key (e.g., "a", "ArrowUp", "Enter")
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

type SelectableFlatItem = FlatItem & { type: "item" };

interface PaletteListData {
  flatList: FlatItem[];
  selectableItems: SelectableFlatItem[];
  selectablePositions: number[];
}

// ============================================================
// Layout Constants
// ============================================================

const PALETTE_WIDTH = 58;
const PALETTE_HEIGHT = 24;
const PADDING = { top: 2, bottom: 2, left: 4, right: 4 };
const HEADER_ROWS = 4; // header + empty + search + empty
const CONTENT_START = PADDING.top + HEADER_ROWS;
const MIN_PALETTE_WIDTH = 40;
const MIN_PALETTE_HEIGHT = 12;
// ============================================================
// Helpers
// ============================================================

/** Build flat list with category headers and selectable metadata in one pass. */
function buildPaletteListData(results: KeybindingMatch[]): PaletteListData {
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
  const flatList: FlatItem[] = [];
  const selectableItems: SelectableFlatItem[] = [];
  const selectablePositions: number[] = [];
  let isFirst = true;

  for (const category of CATEGORY_ORDER) {
    const items = byCategory.get(category);
    if (!items?.length) continue;

    // Add separator before category (except first)
    if (!isFirst) {
      flatList.push({ type: "spacer" });
    }
    isFirst = false;

    // Category header
    flatList.push({ type: "category", category });

    // Spacer after category header for visual breathing room
    flatList.push({ type: "spacer" });

    // Items
    for (const match of items) {
      const item: SelectableFlatItem = { type: "item", match };
      selectablePositions.push(flatList.length);
      selectableItems.push(item);
      flatList.push(item);
    }
  }

  return {
    flatList,
    selectableItems,
    selectablePositions,
  };
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
  const { stdout } = useStdout();
  // Initialize state from props (persistent across open/close)
  const [query, setQuery] = useState(initialState?.query ?? "");
  const [cursorPos, setCursorPos] = useState(initialState?.cursorPos ?? 0);
  const [selectedIndex, setSelectedIndex] = useState(
    initialState?.selectedIndex ?? 0,
  );
  const [scrollOffset, setScrollOffset] = useState(
    initialState?.scrollOffset ?? 0,
  );
  const [cursorVisible, setCursorVisible] = useState(true);
  const terminalColumns = stdout?.columns ?? 0;
  const terminalRows = stdout?.rows ?? 0;
  const overlayFrame = useMemo(
    () =>
      resolveOverlayFrame(PALETTE_WIDTH, PALETTE_HEIGHT, {
        minWidth: MIN_PALETTE_WIDTH,
        minHeight: MIN_PALETTE_HEIGHT,
      }),
    [terminalColumns, terminalRows],
  );
  const contentWidth = Math.max(
    12,
    overlayFrame.width - PADDING.left - PADDING.right,
  );
  const visibleRows = Math.max(
    3,
    overlayFrame.height - CONTENT_START - PADDING.bottom,
  );
  const overlayFrameRef = useRef(overlayFrame);
  const previousFrameRef = useRef<typeof overlayFrame | null>(null);
  const isFirstRender = useRef(true);
  const hasInitialized = useRef(false);
  const prevQueryRef = useRef(query);

  // Rebind mode: waiting for user to press new key combo
  const [rebindMode, setRebindMode] = useState(false);
  const [rebindingId, setRebindingId] = useState<string | null>(null);

  // Theme colors (memoized)
  const colors = useMemo(() => {
    const c = themeToOverlayColors(theme);
    return {
      highlight: c.warning,
      category: c.accent,
      primary: c.primary,
      muted: c.muted,
      bgStyle: bg(OVERLAY_BG_COLOR),
    };
  }, [theme]);

  // Search results and derived data
  const results = useMemo(() => registry.search(query), [query]);
  const { flatList, selectableItems, selectablePositions } = useMemo(
    () => buildPaletteListData(results),
    [results],
  );

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
    const posInList = selectablePositions[selectedIndex];
    if (posInList === undefined) return;

    const visibleEnd = scrollOffset + visibleRows;

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
      setScrollOffset(posInList - visibleRows + 1);
    }
  }, [selectedIndex, selectablePositions, flatList, scrollOffset, visibleRows]);

  // Draw cursor only (optimized for blink)
  const drawCursor = useCallback(() => {
    const frame = overlayFrameRef.current;
    if (frame.width <= 0 || frame.height <= 0) return;

    const searchY = frame.y + PADDING.top + 2;
    const display = buildCursorWindowDisplay(query, cursorPos, contentWidth);
    const cursorX = frame.x + PADDING.left + display.beforeCursor.length;

    const cursorStyle = cursorVisible
      ? ansi.inverse + display.cursorChar + ansi.reset
      : display.cursorChar;

    const output = ansi.cursorSave + ansi.cursorHide +
      ansi.cursorTo(cursorX, searchY) +
      colors.bgStyle + cursorStyle +
      ansi.cursorRestore + ansi.cursorShow;

    writeToTerminal(output);
  }, [query, cursorPos, cursorVisible, colors.bgStyle, contentWidth]);

  // Draw full palette
  const drawPalette = useCallback(() => {
    overlayFrameRef.current = overlayFrame;
    if (shouldClearOverlay(previousFrameRef.current, overlayFrame)) {
      clearOverlay(previousFrameRef.current!);
    }
    previousFrameRef.current = overlayFrame;

    const bgStyle = colors.bgStyle;
    let output = ansi.cursorSave + ansi.cursorHide;

    // Helper: draw empty row
    const drawEmptyRow = (y: number) => {
      output += ansi.cursorTo(overlayFrame.x, y) + bgStyle +
        " ".repeat(overlayFrame.width);
    };

    // === Top padding ===
    for (let i = 0; i < PADDING.top; i++) {
      drawEmptyRow(overlayFrame.y + i);
    }

    // === Header row ===
    const headerY = overlayFrame.y + PADDING.top;
    const title = "Commands";
    const escHint = "esc";
    const headerPad = contentWidth - title.length - escHint.length;

    output += ansi.cursorTo(overlayFrame.x, headerY) + bgStyle;
    output += " ".repeat(PADDING.left);
    output += fg(colors.primary) + ansi.bold + title + ansi.reset + bgStyle;
    output += " ".repeat(Math.max(1, headerPad));
    output += fg(colors.muted) + escHint + ansi.reset + bgStyle;
    output += " ".repeat(PADDING.right);

    // === Empty row after header ===
    drawEmptyRow(headerY + 1);

    // === Search input row ===
    const searchY = headerY + 2;
    output += ansi.cursorTo(overlayFrame.x, searchY) + bgStyle;
    output += " ".repeat(PADDING.left);

    if (rebindMode) {
      // Rebind mode: show "Press new key..." with blinking cursor
      const rebindText = "Press new key combo...";
      output += fg(colors.highlight);
      output += cursorVisible
        ? ansi.inverse + rebindText[0] + ansi.reset + bgStyle +
          fg(colors.highlight) + rebindText.slice(1)
        : rebindText;
      output += ansi.reset + bgStyle;
      output += " ".repeat(contentWidth - rebindText.length);
    } else if (query) {
      const display = buildCursorWindowDisplay(query, cursorPos, contentWidth);
      output += display.beforeCursor;
      output += cursorVisible
        ? ansi.inverse + display.cursorChar + ansi.reset + bgStyle
        : display.cursorChar;
      output += display.afterCursor;
      output += " ".repeat(Math.max(0, contentWidth - display.renderWidth));
    } else {
      // Placeholder with cursor
      output += fg(colors.muted);
      output += cursorVisible
        ? ansi.inverse + "S" + ansi.reset + bgStyle + fg(colors.muted) + "earch"
        : "Search";
      output += ansi.reset + bgStyle;
      output += " ".repeat(Math.max(0, contentWidth - 6));
    }
    output += " ".repeat(PADDING.right);

    // === Empty row after search ===
    drawEmptyRow(searchY + 1);

    // === Content rows ===
    const visibleList = flatList.slice(
      scrollOffset,
      scrollOffset + visibleRows,
    );
    const selectedItem = selectableItems[selectedIndex];

    for (let row = 0; row < visibleRows; row++) {
      const rowY = overlayFrame.y + CONTENT_START + row;
      const item = visibleList[row];

      output += ansi.cursorTo(overlayFrame.x, rowY) + bgStyle;

      if (!item) {
        // Empty row
        output += " ".repeat(overlayFrame.width);
      } else if (item.type === "spacer") {
        // Spacer row
        output += " ".repeat(overlayFrame.width);
      } else if (item.type === "category") {
        // Category header
        output += " ".repeat(PADDING.left);
        output += fg(colors.category) + ansi.bold;
        const catText = item.category.slice(0, contentWidth);
        output += catText;
        output += ansi.reset + bgStyle;
        output += " ".repeat(
          Math.max(0, overlayFrame.width - PADDING.left - catText.length),
        );
      } else {
        // Item row
        const { match } = item;
        const isSelected = item === selectedItem;
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
    const footerStartY = overlayFrame.y + CONTENT_START + visibleRows;
    for (let i = 0; i < PADDING.bottom - 1; i++) {
      drawEmptyRow(footerStartY + i);
    }

    // === Footer row ===
    const footerY = overlayFrame.y + overlayFrame.height - 1;
    // Show different hints based on mode
    const hintText = rebindMode
      ? "esc=cancel"
      : onRebind
      ? "tab=rebind ⌨=shortcut"
      : "⌨=shortcut only";
    const posText = selectableItems.length > 0
      ? `${selectedIndex + 1}/${selectableItems.length}`
      : "";

    output += ansi.cursorTo(overlayFrame.x, footerY) + bgStyle;
    output += " ".repeat(PADDING.left);
    output += fg(colors.muted) + hintText;
    const middlePad = overlayFrame.width - PADDING.left - hintText.length -
      posText.length - PADDING.right;
    output += " ".repeat(Math.max(1, middlePad));
    output += posText + ansi.reset + bgStyle;
    output += " ".repeat(PADDING.right);

    output += drawOverlayFrame(overlayFrame, {
      borderColor: colors.primary,
      backgroundColor: OVERLAY_BG_COLOR,
    });
    output += ansi.reset + ansi.cursorRestore + ansi.cursorShow;

    writeToTerminal(output);
  }, [
    query,
    cursorPos,
    cursorVisible,
    flatList,
    selectableItems,
    selectedIndex,
    scrollOffset,
    colors,
    rebindMode,
    onRebind,
    contentWidth,
    overlayFrame,
    visibleRows,
  ]);

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
  }, [
    query,
    cursorPos,
    selectedIndex,
    scrollOffset,
    flatList,
    drawPalette,
    rebindMode,
  ]);

  // Reset cursor visibility when typing
  useEffect(() => {
    setCursorVisible(true);
  }, [query]);

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
        key: input ||
          (key.return
            ? "Enter"
            : key.tab
            ? "Tab"
            : key.upArrow
            ? "ArrowUp"
            : key.downArrow
            ? "ArrowDown"
            : key.leftArrow
            ? "ArrowLeft"
            : key.rightArrow
            ? "ArrowRight"
            : key.backspace
            ? "Backspace"
            : key.delete
            ? "Delete"
            : key.pageUp
            ? "PageUp"
            : key.pageDown
            ? "PageDown"
            : "unknown"),
        ctrl: key.ctrl,
        meta: key.meta,
        alt: key.escape, // Option/Alt on macOS sends escape
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
    // Note: Ctrl+P removed - it's handled by App.tsx for toggle (open/close)
    if (key.upArrow) {
      if (selectableItems.length === 0) return;
      setSelectedIndex((
        i: number,
      ) => (i <= 0 ? selectableItems.length - 1 : i - 1));
      return;
    }

    // Ctrl+N for navigate down (Emacs-style)
    if (key.downArrow || (key.ctrl && input === "n")) {
      if (selectableItems.length === 0) return;
      setSelectedIndex((
        i: number,
      ) => (i >= selectableItems.length - 1 ? 0 : i + 1));
      return;
    }

    if (key.pageUp) {
      if (selectableItems.length === 0) return;
      setSelectedIndex((i: number) => Math.max(0, i - visibleRows));
      return;
    }

    if (key.pageDown) {
      if (selectableItems.length === 0) return;
      setSelectedIndex((i: number) =>
        Math.min(selectableItems.length - 1, i + visibleRows)
      );
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
