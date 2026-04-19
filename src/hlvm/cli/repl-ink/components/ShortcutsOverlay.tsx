/**
 * Shortcuts Overlay
 *
 * Concise, true-floating shortcuts panel for the REPL.
 * Built from the keybinding registry SSOT plus a few curated section ids.
 */

import React, { useMemo } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { useSemanticColors } from "../../theme/index.ts";
import { getDisplay, type Keybinding, registry } from "../keybindings/index.ts";
import {
  fitOverlayRect,
  resolveOverlayChromeLayout,
  SHORTCUTS_OVERLAY_SPEC,
} from "../overlay/index.ts";
import { OverlayBalancedRow, OverlayModal } from "./OverlayModal.tsx";
import { buildSectionLabelText } from "../utils/display-chrome.ts";

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
      "conversation-search",
      "conversation-search-prev",
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
  const sc = useSemanticColors();
  const { stdout } = useStdout();
  const terminalColumns = stdout?.columns ?? 0;
  const terminalRows = stdout?.rows ?? 0;

  const sections = useMemo(() => buildShortcutSections(), []);
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
  const contentWidth = Math.max(
    12,
    overlay.width - PADDING.left - PADDING.right - 2,
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

  useInput((_input, key) => {
    if (key.escape || key.return) {
      onClose();
    }
  });

  return (
    <OverlayModal
      title="Shortcuts"
      rightText="esc close"
      width={overlay.width}
      minHeight={overlay.height}
    >
      {visibleSections.map((section: ShortcutSection) => (
        <Box
          key={section.title}
          marginTop={section.title === visibleSections[0]?.title ? 0 : 1}
          paddingLeft={PADDING.left}
          flexDirection="column"
        >
          <Text color={sc.chrome.sectionLabel}>
            {buildSectionLabelText(section.title, contentWidth)}
          </Text>
          {section.rows.map((row: ShortcutRow) => (
            <Box key={`${section.title}:${row.label}`}>
              <OverlayBalancedRow
                leftText={row.label}
                rightText={row.display}
                width={contentWidth}
                leftColor={sc.text.primary}
                rightColor={sc.footer.status.active}
                maxRightWidth={displayWidth}
              />
            </Box>
          ))}
        </Box>
      ))}

      <Box paddingLeft={PADDING.left} marginTop={1}>
        <Text color={sc.text.muted} wrap="truncate-end">
          {hasHiddenRows
            ? "Widen terminal for more · /help for full list"
            : "Ctrl+P command palette · Esc close"}
        </Text>
      </Box>
    </OverlayModal>
  );
}
