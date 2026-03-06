/**
 * Shortcuts Overlay
 *
 * Concise, true-floating shortcuts panel for the REPL.
 * Built from the keybinding registry SSOT plus a few curated section ids.
 */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useInput } from "ink";
import { useTheme } from "../../theme/index.ts";
import { getDisplay, registry } from "../keybindings/index.ts";
import type { Keybinding } from "../keybindings/index.ts";
import {
  ansi,
  bg,
  calcOverlayPosition,
  clearOverlay,
  fg,
  hexToRgb,
  OVERLAY_BG_COLOR,
  type RGB,
  writeToTerminal,
} from "../overlay/index.ts";

interface ShortcutsOverlayProps {
  onClose: () => void;
}

interface ShortcutRow {
  display: string;
  label: string;
}

interface ShortcutSection {
  title: string;
  rows: ShortcutRow[];
}

const SECTION_IDS = [
  {
    title: "General",
    ids: ["question-mark", "ctrl+p", "ctrl+b", "/help"],
  },
  {
    title: "Conversation",
    ids: ["ctrl+o", "ctrl+y", "esc-global", "pgup-pgdn"],
  },
] as const;

const OVERLAY_WIDTH = 58;
const OVERLAY_HEIGHT = 17;
const PADDING = { top: 1, bottom: 1, left: 2, right: 2 };

function padRight(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, " ");
}

function getRegistryMap(): Map<string, Keybinding> {
  return new Map(registry.getAll().map((binding) => [binding.id, binding]));
}

export function buildShortcutSections(): ShortcutSection[] {
  const byId = getRegistryMap();
  const sections: ShortcutSection[] = [];

  for (const section of SECTION_IDS) {
    const rows = section.ids.flatMap((id): ShortcutRow[] => {
      const binding = byId.get(id);
      if (!binding) return [];
      return [{
        display: getDisplay(binding),
        label: binding.label,
      }];
    });
    if (rows.length > 0) {
      sections.push({ title: section.title, rows });
    }
  }

  return sections;
}

export function ShortcutsOverlay({
  onClose,
}: ShortcutsOverlayProps): React.ReactElement | null {
  const { theme } = useTheme();
  const overlayPosRef = useRef({ x: 0, y: 0 });

  const colors = useMemo(() => ({
    primary: hexToRgb(theme.primary) as RGB,
    accent: hexToRgb(theme.accent) as RGB,
    muted: hexToRgb(theme.muted) as RGB,
    bgStyle: bg(OVERLAY_BG_COLOR),
  }), [theme]);

  const sections = useMemo(() => buildShortcutSections(), []);

  const drawOverlay = useCallback(() => {
    const pos = calcOverlayPosition(OVERLAY_WIDTH, OVERLAY_HEIGHT);
    overlayPosRef.current = pos;

    const contentWidth = OVERLAY_WIDTH - PADDING.left - PADDING.right;
    const displayWidth = 12;
    const bgStyle = colors.bgStyle;
    let output = ansi.cursorSave + ansi.cursorHide;

    const drawRow = (y: number, render: () => number): void => {
      output += ansi.cursorTo(pos.x, y) + bgStyle;
      const visibleLen = render();
      const remaining = OVERLAY_WIDTH - visibleLen;
      if (remaining > 0) output += " ".repeat(remaining);
    };

    const drawEmptyRow = (y: number): void => drawRow(y, () => 0);

    for (let i = 0; i < PADDING.top; i++) {
      drawEmptyRow(pos.y + i);
    }

    const headerY = pos.y + PADDING.top;
    drawRow(headerY, () => {
      const title = "Shortcuts";
      const closeHint = "esc/?";
      output += " ".repeat(PADDING.left);
      output += fg(colors.primary) + ansi.bold + title + ansi.reset + bgStyle;
      const pad = contentWidth - title.length - closeHint.length;
      output += " ".repeat(Math.max(1, pad));
      output += fg(colors.muted) + closeHint + ansi.reset + bgStyle;
      output += " ".repeat(PADDING.right);
      return OVERLAY_WIDTH;
    });

    drawRow(headerY + 1, () => {
      const hint = "Summary first by default. Expand only when you need detail.";
      output += " ".repeat(PADDING.left);
      output += fg(colors.muted) + hint.slice(0, contentWidth) + ansi.reset + bgStyle;
      return PADDING.left + Math.min(hint.length, contentWidth);
    });

    let rowY = headerY + 3;
    for (const section of sections) {
      drawRow(rowY, () => {
        output += " ".repeat(PADDING.left);
        output += fg(colors.accent) + section.title + ansi.reset + bgStyle;
        return PADDING.left + section.title.length;
      });
      rowY += 1;

      for (const row of section.rows) {
        drawRow(rowY, () => {
          const visibleLabel = row.label.slice(0, Math.max(0, contentWidth - displayWidth - 2));
          output += " ".repeat(PADDING.left);
          output += fg(colors.primary) + padRight(row.display, displayWidth) + ansi.reset + bgStyle;
          output += "  ";
          output += visibleLabel;
          return PADDING.left + displayWidth + 2 + visibleLabel.length;
        });
        rowY += 1;
      }

      rowY += 1;
    }

    const footerY = pos.y + OVERLAY_HEIGHT - PADDING.bottom - 1;
    drawRow(footerY, () => {
      const footer = "Use ? on an empty prompt to reopen";
      output += " ".repeat(PADDING.left);
      output += fg(colors.muted) + footer + ansi.reset + bgStyle;
      return PADDING.left + footer.length;
    });

    for (let i = 0; i < PADDING.bottom; i++) {
      drawEmptyRow(pos.y + OVERLAY_HEIGHT - PADDING.bottom + i);
    }

    output += ansi.reset + ansi.cursorRestore + ansi.cursorShow;
    writeToTerminal(output);
  }, [colors, sections]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  useEffect(() => {
    return () => {
      const pos = overlayPosRef.current;
      if (pos.x !== 0 || pos.y !== 0) {
        clearOverlay({
          x: pos.x,
          y: pos.y,
          width: OVERLAY_WIDTH,
          height: OVERLAY_HEIGHT,
        });
      }
    };
  }, []);

  useInput((input, key) => {
    if (key.escape || input === "?") {
      onClose();
    }
  });

  return null;
}
