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
  createModalOverlayScaffold,
  fitOverlayRect,
  resolveOverlayChromeLayout,
  SHORTCUTS_OVERLAY_SPEC,
  themeToOverlayColors,
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
    ids: ["ctrl+p", "ctrl+b", "ctrl+t"],
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

  if (sections.length > 0) {
    sections[0] = {
      ...sections[0],
      rows: [{ display: "?", label: "Shortcuts" }, ...sections[0].rows],
    };
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
      accent: c.section,
      muted: c.meta,
      fieldText: c.fieldText,
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
    const surface = createModalOverlayScaffold({
      frame: { ...overlay, clipped: false },
      colors: themeToOverlayColors(theme),
      title: "Shortcuts",
      rightText: "esc",
    });
    surface.blankRows(overlay.y, overlay.height);

    const headerY = overlay.y + PADDING.top;

    surface.textRow(
      headerY,
      "Summary first by default. Expand only when you need detail.".slice(
        0,
        contentWidth,
      ),
      {
        paddingLeft: PADDING.left,
        color: colors.muted,
      },
    );

    surface.blankRow(headerY + 1);

    let rowY = overlay.y + chromeLayout.contentStart;
    for (const section of visibleSections) {
      surface.sectionRow(rowY, section.title, contentWidth, {
        paddingLeft: PADDING.left,
        color: colors.accent,
      });
      rowY += 1;

      for (const row of section.rows) {
        surface.balancedRow(
          rowY,
          row.label,
          row.display,
          contentWidth,
          {
            paddingLeft: PADDING.left,
            leftColor: colors.fieldText,
            rightColor: colors.primary,
            maxRightWidth: displayWidth,
          },
        );
        rowY += 1;
      }

      rowY += 1;
    }

    const footerY = overlay.y + chromeLayout.footerY;
    surface.textRow(
      footerY,
      (hasHiddenRows
        ? "Reopen with /help. Widen terminal for the full list."
        : "Reopen with /help. Ctrl+P opens command palette.").slice(
          0,
          contentWidth,
        ),
      {
        paddingLeft: PADDING.left,
        color: colors.muted,
      },
    );

    surface.blankRows(
      overlay.y + overlayHeight - PADDING.bottom,
      PADDING.bottom,
    );

    writeToTerminal(surface.finish());
  }, [colors, sections, terminalColumns, terminalRows, theme]);

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
