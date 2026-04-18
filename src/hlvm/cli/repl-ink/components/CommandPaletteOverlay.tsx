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
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Text, useInput, useStdout } from "ink";
import {
  CATEGORY_ORDER,
  getDisplay,
  type KeybindingAction,
  type KeybindingCategory,
  type KeybindingMatch,
  registry,
} from "../keybindings/index.ts";
import {
  COMMAND_PALETTE_OVERLAY_SPEC,
  resolveOverlayChromeLayout,
  resolveOverlayFrame,
} from "../overlay/index.ts";
import { useSemanticColors } from "../../theme/index.ts";
import { handleTextEditingKey } from "../utils/text-editing.ts";
import { CURSOR_BLINK_MS } from "../ui-constants.ts";
import { buildFieldDisplayState } from "../utils/field-display.ts";
import {
  buildPaletteCategoryLabel,
  buildPaletteHeaderLayout,
  buildPaletteItemLayout,
} from "../utils/palette-layout.ts";
import { OverlayBalancedRow, OverlayModal } from "./OverlayModal.tsx";

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

const PADDING = COMMAND_PALETTE_OVERLAY_SPEC.padding;
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

function PaletteSearchField(
  {
    query,
    cursor,
    width,
    placeholder,
    cursorVisible,
    active,
  }: {
    query: string;
    cursor: number;
    width: number;
    placeholder: string;
    cursorVisible: boolean;
    active: boolean;
  },
): React.ReactElement {
  const sc = useSemanticColors();
  const contentWidth = Math.max(8, width - 4);
  const display = buildFieldDisplayState(query, cursor, contentWidth, placeholder);

  return (
    <Box
      borderStyle="single"
      borderColor={active ? sc.surface.field.borderActive : sc.surface.field.border}
      backgroundColor={sc.surface.field.background}
      paddingX={1}
      width={width}
    >
      {display.isPlaceholder
        ? (
          <>
            <Text
              inverse={cursorVisible}
              backgroundColor={sc.surface.field.background}
              color={sc.surface.field.cursor}
            >
              {display.cursorChar}
            </Text>
            <Text
              color={sc.surface.field.placeholder}
              backgroundColor={sc.surface.field.background}
              wrap="truncate-end"
            >
              {display.placeholderText}
            </Text>
          </>
        )
        : (
          <>
            <Text
              color={active ? sc.status.warning : sc.surface.field.text}
              backgroundColor={sc.surface.field.background}
            >
              {display.beforeCursor}
            </Text>
            <Text
              inverse={cursorVisible}
              backgroundColor={sc.surface.field.background}
              color={sc.surface.field.cursor}
            >
              {display.cursorChar}
            </Text>
            <Text
              color={active ? sc.status.warning : sc.surface.field.text}
              backgroundColor={sc.surface.field.background}
            >
              {display.afterCursor}
            </Text>
          </>
        )}
    </Box>
  );
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
  const sc = useSemanticColors();
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
      resolveOverlayFrame(
        COMMAND_PALETTE_OVERLAY_SPEC.width,
        COMMAND_PALETTE_OVERLAY_SPEC.height,
        {
          minWidth: COMMAND_PALETTE_OVERLAY_SPEC.minWidth,
          minHeight: COMMAND_PALETTE_OVERLAY_SPEC.minHeight,
        },
      ),
    [terminalColumns, terminalRows],
  );
  const chromeLayout = useMemo(
    () =>
      resolveOverlayChromeLayout(
        overlayFrame.height,
        COMMAND_PALETTE_OVERLAY_SPEC,
      ),
    [overlayFrame.height],
  );
  const contentWidth = Math.max(
    12,
    overlayFrame.width - PADDING.left - PADDING.right,
  );
  const visibleRows = Math.max(
    3,
    chromeLayout.visibleRows,
  );
  const hasInitialized = useRef(false);
  const prevQueryRef = useRef(query);

  // Rebind mode: waiting for user to press new key combo
  const [rebindMode, setRebindMode] = useState(false);
  const [rebindingId, setRebindingId] = useState<string | null>(null);

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

  // Cursor blink effect
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorVisible((v: boolean) => !v);
    }, CURSOR_BLINK_MS);
    return () => clearInterval(interval);
  }, []);

  // Reset cursor visibility when typing
  useEffect(() => {
    setCursorVisible(true);
  }, [query]);

  const headerLayout = buildPaletteHeaderLayout({
    query,
    resultCount: selectableItems.length,
    selectedCount: selectedIndex >= 0 ? selectedIndex + 1 : 0,
    rebindMode,
  }, contentWidth);
  const visibleList = flatList.slice(
    scrollOffset,
    scrollOffset + visibleRows,
  );
  const selectedItem = selectableItems[selectedIndex];
  const hintText = rebindMode
    ? "esc=cancel"
    : onRebind
    ? "tab=rebind ⌨=shortcut"
    : "⌨=shortcut only";
  const posText = selectableItems.length > 0
    ? `${selectedIndex + 1}/${selectableItems.length}`
    : "";

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

  return (
    <OverlayModal
      title="Commands"
      rightText="esc"
      width={overlayFrame.width}
      minHeight={overlayFrame.height}
    >
      <Box paddingLeft={PADDING.left} flexDirection="column">
        <OverlayBalancedRow
          leftText={headerLayout.leftText}
          rightText={headerLayout.rightText}
          width={contentWidth}
          leftColor={sc.text.muted}
          rightColor={sc.chrome.sectionLabel}
        />
      </Box>

      <Box paddingLeft={PADDING.left} marginTop={1}>
        <PaletteSearchField
          query={rebindMode ? "Press new key combo..." : query}
          cursor={rebindMode ? 0 : cursorPos}
          width={contentWidth}
          placeholder="Search"
          cursorVisible={cursorVisible}
          active={rebindMode}
        />
      </Box>

      <Box paddingLeft={PADDING.left} marginTop={1} flexDirection="column">
        {visibleList.map((item: FlatItem, index: number) => {
          if (item.type === "spacer") {
            return <Box key={`spacer:${scrollOffset + index}`} />;
          }
          if (item.type === "category") {
            return (
              <Box key={`category:${item.category}`}>
                <Text color={sc.chrome.sectionLabel} bold>
                  {buildPaletteCategoryLabel(item.category, contentWidth)}
                </Text>
              </Box>
            );
          }

          const { match } = item;
          const isSelected = item === selectedItem;
          const kb = match.keybinding;
          const display = getDisplay(kb);
          const isInfoOnly = kb.action.type === "INFO";
          const itemLayout = buildPaletteItemLayout(
            kb.label,
            display,
            Math.max(0, contentWidth - 2),
          );

          return (
            <Box key={`item:${kb.id}`}>
              <Text color={isSelected ? sc.footer.status.active : sc.text.muted}>
                {isInfoOnly ? "⌨ " : isSelected ? "▸ " : "  "}
              </Text>
              <Text
                color={isSelected ? sc.text.primary : isInfoOnly ? sc.text.muted : sc.text.primary}
                dimColor={isInfoOnly && !isSelected}
              >
                {itemLayout.leftText}
              </Text>
              {itemLayout.gapWidth > 0 && (
                <Text>{" ".repeat(itemLayout.gapWidth)}</Text>
              )}
              <Text color={isSelected ? sc.text.primary : sc.text.muted}>
                {itemLayout.rightText}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box paddingLeft={PADDING.left} marginTop={1}>
        <OverlayBalancedRow
          leftText={hintText}
          rightText={posText}
          width={contentWidth}
          leftColor={sc.text.muted}
          rightColor={sc.text.muted}
        />
      </Box>
    </OverlayModal>
  );
}
