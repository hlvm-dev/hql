/**
 * Shortcuts Overlay
 *
 * Concise, true-floating shortcuts panel for the REPL.
 * Built from the keybinding registry SSOT plus a few curated section ids.
 */

import React, { useCallback, useEffect, useMemo } from "react";
import { useInput, useStdout } from "ink";
import { useTheme } from "../../theme/index.ts";
import { getDisplay, type Keybinding, registry } from "../keybindings/index.ts";
import {
  ansi,
  bg,
  drawOverlayFrame,
  fg,
  fitOverlayRect,
  OVERLAY_BG_COLOR,
  resolveOverlayChromeLayout,
  SHORTCUTS_OVERLAY_SPEC,
  themeToOverlayColors,
  writeToTerminal,
} from "../overlay/index.ts";
import {
  buildRightSlotTextLayout,
  buildSectionLabelText,
} from "../utils/display-chrome.ts";

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
    ids: ["ctrl+p", "ctrl+b", "ctrl+t", "/help"],
  },
  {
    title: "Conversation",
    ids: [
      "ctrl+o",
      "ctrl+y",
      "shift+tab",
      "ctrl+enter-force",
      "esc-global",
      "pgup-pgdn",
    ],
  },
] as const;

const PADDING = SHORTCUTS_OVERLAY_SPEC.padding;

function getOverlayHeight(sections: readonly ShortcutSection[]): number {
  const sectionRows = sections.reduce(
    (rows: number, section: ShortcutSection) => rows + section.rows.length + 2,
    0,
  );
  return PADDING.top + PADDING.bottom + sectionRows + 4;
}

function fitShortcutSections(
  sections: readonly ShortcutSection[],
  maxBodyRows: number,
): ShortcutSection[] {
  if (maxBodyRows <= 0) return [];

  const fitted: ShortcutSection[] = [];
  let usedRows = 0;

  for (const section of sections) {
    const rowsRemaining = maxBodyRows - usedRows;
    if (rowsRemaining < 2) break;

    const visibleRows = section.rows.slice(0, Math.max(1, rowsRemaining - 2));
    if (visibleRows.length === 0) break;

    fitted.push({
      title: section.title,
      rows: visibleRows,
    });
    usedRows += visibleRows.length + 2;

    if (visibleRows.length < section.rows.length) {
      break;
    }
  }

  return fitted;
}

function getRegistryMap(): Map<string, Keybinding> {
  return new Map(registry.getAll().map((binding) => [binding.id, binding]));
}

function buildShortcutSections(): ShortcutSection[] {
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
  const { stdout } = useStdout();
  const terminalColumns = stdout?.columns ?? 0;
  const terminalRows = stdout?.rows ?? 0;

  const colors = useMemo(() => {
    const c = themeToOverlayColors(theme);
    return {
      primary: c.primary,
      accent: c.accent,
      muted: c.muted,
      bgStyle: bg(OVERLAY_BG_COLOR),
    };
  }, [theme]);

  const sections = useMemo(() => buildShortcutSections(), []);

  const drawOverlay = useCallback(() => {
    const desiredHeight = getOverlayHeight(sections);
    const overlay = fitOverlayRect(
      SHORTCUTS_OVERLAY_SPEC.width,
      desiredHeight,
      {
        marginX: 1,
        marginY: 1,
      },
    );
    const chromeLayout = resolveOverlayChromeLayout(
      overlay.height,
      SHORTCUTS_OVERLAY_SPEC,
    );
    const overlayHeight = overlay.height;
    const contentWidth = Math.max(
      12,
      overlay.width - PADDING.left - PADDING.right,
    );
    const displayWidth = Math.max(
      8,
      Math.min(12, Math.floor(contentWidth * 0.3)),
    );
    const bodyRows = chromeLayout.visibleRows;
    const visibleSections = fitShortcutSections(sections, bodyRows);
    const renderedRowCount = visibleSections.reduce(
      (rows: number, section: ShortcutSection) => rows + section.rows.length,
      0,
    );
    const totalRowCount = sections.reduce(
      (rows: number, section: ShortcutSection) => rows + section.rows.length,
      0,
    );
    const hasHiddenRows = renderedRowCount < totalRowCount;
    const bgStyle = colors.bgStyle;
    let output = ansi.cursorSave + ansi.cursorHide;

    const drawRow = (y: number, render: () => number): void => {
      output += ansi.cursorTo(overlay.x, y) + bgStyle;
      const visibleLen = render();
      const remaining = overlay.width - visibleLen;
      if (remaining > 0) output += " ".repeat(remaining);
    };

    const drawEmptyRow = (y: number): void => drawRow(y, () => 0);

    for (let i = 0; i < PADDING.top; i++) {
      drawEmptyRow(overlay.y + i);
    }

    const headerY = overlay.y + PADDING.top;

    drawRow(headerY, () => {
      const hint =
        "Summary first by default. Expand only when you need detail.";
      output += " ".repeat(PADDING.left);
      output += fg(colors.muted) + hint.slice(0, contentWidth) + ansi.reset +
        bgStyle;
      return PADDING.left + Math.min(hint.length, contentWidth);
    });

    drawEmptyRow(headerY + 1);

    let rowY = overlay.y + chromeLayout.contentStart;
    for (const section of visibleSections) {
      drawRow(rowY, () => {
        output += " ".repeat(PADDING.left);
        const label = buildSectionLabelText(section.title, contentWidth);
        output += fg(colors.accent) + label + ansi.reset + bgStyle;
        return PADDING.left + label.length;
      });
      rowY += 1;

      for (const row of section.rows) {
        drawRow(rowY, () => {
          const layout = buildRightSlotTextLayout(
            contentWidth,
            row.label,
            row.display,
            displayWidth,
          );
          output += " ".repeat(PADDING.left);
          output += layout.leftText;
          output += " ".repeat(layout.gapWidth);
          output += fg(colors.primary) + layout.rightText + ansi.reset +
            bgStyle;
          return PADDING.left + layout.leftText.length + layout.gapWidth +
            layout.rightText.length;
        });
        rowY += 1;
      }

      rowY += 1;
    }

    const footerY = overlay.y + chromeLayout.footerY;
    drawRow(footerY, () => {
      const footer = hasHiddenRows
        ? "Reopen with /help. Widen terminal for the full list."
        : "Reopen with /help. Ctrl+P opens command palette.";
      output += " ".repeat(PADDING.left);
      const visibleFooter = footer.slice(0, contentWidth);
      output += fg(colors.muted) + visibleFooter + ansi.reset + bgStyle;
      return PADDING.left + visibleFooter.length;
    });

    for (let i = 0; i < PADDING.bottom; i++) {
      drawEmptyRow(overlay.y + overlayHeight - PADDING.bottom + i);
    }

    output += drawOverlayFrame(overlay, {
      borderColor: colors.muted,
      backgroundColor: OVERLAY_BG_COLOR,
      title: "Shortcuts",
      rightText: "esc",
    });
    output += ansi.reset + ansi.cursorRestore + ansi.cursorShow;
    writeToTerminal(output);
  }, [colors, sections, terminalColumns, terminalRows]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  useInput((_input, key) => {
    if (key.escape || key.return) {
      onClose();
    }
  });

  return null;
}
