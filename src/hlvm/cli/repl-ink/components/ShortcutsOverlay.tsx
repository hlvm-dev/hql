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
import { OverlayModal } from "./OverlayModal.tsx";

interface ShortcutsOverlayProps {
  onClose: () => void;
}

interface HelpRow {
  text: string;
}

interface HelpRowDefinition {
  kind: "binding" | "literal";
  id?: string;
  display?: string;
  suffix: string;
}

const HELP_ROWS: readonly HelpRowDefinition[] = [
  { kind: "binding", id: "ctrl+p", suffix: "commands" },
  { kind: "binding", id: "ctrl+o", suffix: "history" },
  { kind: "binding", id: "ctrl+t", suffix: "tasks" },
  { kind: "binding", id: "ctrl+b", suffix: "background" },
  { kind: "binding", id: "shift+tab", suffix: "cycle mode" },
  { kind: "binding", id: "ctrl+enter-force", suffix: "send now" },
  { kind: "binding", id: "pgup-pgdn", suffix: "scroll" },
  { kind: "binding", id: "esc-global", suffix: "cancel or close" },
  { kind: "literal", display: "/model", suffix: "switch model" },
  { kind: "literal", display: "/config", suffix: "settings" },
] as const;

const PADDING = SHORTCUTS_OVERLAY_SPEC.padding;

function getOverlayHeight(rowCount: number): number {
  return PADDING.top + PADDING.bottom + rowCount + 4;
}

function formatDisplay(display: string): string {
  return display.replace(/\+/g, "+").trim();
}

function getRegistryMap(): Map<string, Keybinding> {
  return new Map(registry.getAll().map((binding) => [binding.id, binding]));
}

function buildHelpRows(): HelpRow[] {
  const byId = getRegistryMap();
  return HELP_ROWS.flatMap((row): HelpRow[] => {
    const display = row.kind === "literal"
      ? row.display
      : row.id
      ? getDisplay(byId.get(row.id) ?? {
        id: row.id,
        display: row.id,
        label: row.id,
        category: "Global",
        action: { type: "INFO" },
      } as Keybinding)
      : undefined;
    if (!display) return [];
    return [{ text: `${formatDisplay(display)} ${row.suffix}` }];
  });
}

export function ShortcutsOverlay({
  onClose,
}: ShortcutsOverlayProps): React.ReactElement | null {
  const sc = useSemanticColors();
  const { stdout } = useStdout();
  const terminalColumns = stdout?.columns ?? 0;
  const terminalRows = stdout?.rows ?? 0;

  const rows = useMemo(() => buildHelpRows(), []);
  const desiredHeight = getOverlayHeight(rows.length);
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
  const contentWidth = Math.max(20, overlay.width - PADDING.left - PADDING.right - 2);
  const columnCount = contentWidth >= 66 ? 2 : 1;
  const columnGap = columnCount > 1 ? 3 : 0;
  const columnWidth = Math.max(
    16,
    Math.floor((contentWidth - columnGap) / columnCount),
  );
  const maxVisibleRowsPerColumn = Math.max(1, chromeLayout.visibleRows);
  const maxVisibleRows = maxVisibleRowsPerColumn * columnCount;
  const visibleRows = rows.slice(0, maxVisibleRows);
  const hiddenCount = rows.length - visibleRows.length;
  const rowsPerColumn = Math.ceil(visibleRows.length / columnCount);
  const columns: HelpRow[][] = Array.from({ length: columnCount }, (_, index) =>
    visibleRows.slice(index * rowsPerColumn, (index + 1) * rowsPerColumn)
  );

  useInput((_input, key) => {
    if (key.escape || key.return) {
      onClose();
    }
  });

  return (
    <OverlayModal
      title="Help"
      rightText="esc"
      width={overlay.width}
      titleStyle="text"
    >
      <Box
        paddingLeft={PADDING.left}
        flexDirection={columnCount > 1 ? "row" : "column"}
        gap={columnGap}
      >
        {columns.map((column, index) => (
          <Box key={`help-column-${index}`} flexDirection="column" width={columnWidth}>
            {column.map((row: HelpRow) => (
              <Text key={row.text} color={sc.text.muted} wrap="truncate-end">
                {row.text}
              </Text>
            ))}
          </Box>
        ))}
      </Box>
      <Box paddingLeft={PADDING.left}>
        <Text color={sc.text.muted} wrap="truncate-end">
          {hiddenCount > 0
            ? `Esc close · widen terminal for ${hiddenCount} more`
            : "Esc close · /help full command list"}
        </Text>
      </Box>
    </OverlayModal>
  );
}
