/**
 * MemoryPickerOverlay — interactive `/memory` picker.
 *
 * Mirrors CC's `commands/memory/memory.tsx` + `MemoryFileSelector.tsx`.
 * Shows three rows (User memory, Auto-memory MEMORY.md,
 * Open auto-memory folder), lets the user pick one with ↑↓/Enter or
 * number keys 1–3, and spawns $VISUAL/$EDITOR/vi against the chosen
 * `.md` path (or asks the OS to reveal the folder). Esc cancels.
 *
 * Editor handoff: leaves Ink mounted and spawns the editor with `inherit`
 * stdio — vim/nano take the alternate screen via their own terminal codes,
 * and on quit the terminal restores Ink's prior state. We deliberately do
 * NOT call `useApp().exit()` here: that resolves `waitUntilExit()` in
 * `startInkRepl` and would terminate the entire HLVM process. Real
 * pause/resume of Ink (alternate-screen handoff a la CC's promptEditor)
 * is a known TODO — current behavior is "REPL survives editor exit," not
 * "no rendering glitches while editor is up."
 *
 * Out of scope (intentional, per plan v3 continuation):
 *   - Auto-memory toggle row (read-only status row instead)
 *   - Auto-dream status row (AUTODREAM out of scope)
 *   - Team / agent / @-imported nested rows
 */

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useSemanticColors } from "../../theme/index.ts";
import { OverlayModal } from "./OverlayModal.tsx";
import { PickerRow } from "./PickerRow.tsx";
import { getPickerColors } from "../utils/picker-theme.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import {
  getAutoMemEntrypoint,
  getUserMemoryPath,
  isAutoMemoryEnabled,
} from "../../../memory/paths.ts";
import { editFileInEditorWithInkPause } from "../../repl/edit-in-editor.ts";

interface MemoryPickerOverlayProps {
  width: number;
  /** Callback to close the overlay (typically `setActiveOverlay("none")`). */
  onClose: () => void;
  /**
   * Optional initial selection from the slash-command argument
   * (`/memory user|auto`). When provided, the picker opens with that row
   * pre-selected; the user still confirms with Enter.
   */
  initialSelection?: "user" | "auto";
  /**
   * Callback invoked after the editor exits (for transcript-line output).
   * The picker itself just closes; this hook lets the host emit a
   * "Opened memory file at <path>" line into the conversation.
   */
  onEditorExit?: (
    path: string,
    exitCode: number,
  ) => void;
}

interface MemoryRow {
  key: "user" | "auto" | "folder";
  /** "edit" → spawn $EDITOR; "open-folder" → platform.openUrl on the dir */
  action: "edit" | "open-folder";
  label: string;
  path: string;
  description: string;
}

function homeRelative(path: string): string {
  const home = getPlatform().env.get("HOME") ?? "";
  if (home && path.startsWith(home + "/")) return "~" + path.slice(home.length);
  return path;
}

async function buildRows(): Promise<MemoryRow[]> {
  const platform = getPlatform();
  const userPath = getUserMemoryPath();
  const autoPath = getAutoMemEntrypoint();

  async function existsLabel(p: string): Promise<string> {
    try {
      return (await platform.fs.exists(p)) ? "" : " (new)";
    } catch {
      return " (new)";
    }
  }

  const autoDir = platform.path.dirname(autoPath);
  return [
    {
      key: "user",
      action: "edit",
      label: "User memory",
      path: userPath,
      description: `${homeRelative(userPath)}${await existsLabel(userPath)}`,
    },
    {
      key: "auto",
      action: "edit",
      label: "Auto-memory MEMORY.md",
      path: autoPath,
      description: `${homeRelative(autoPath)}${await existsLabel(autoPath)}`,
    },
    {
      key: "folder",
      action: "open-folder",
      label: "Open auto-memory folder",
      path: autoDir,
      description: homeRelative(autoDir),
    },
  ];
}

function initialIndex(rows: MemoryRow[], initial?: "user" | "auto"): number {
  if (!initial) return 0;
  const idx = rows.findIndex((r) => r.key === initial);
  return idx >= 0 ? idx : 0;
}

export function MemoryPickerOverlay({
  width,
  onClose,
  initialSelection,
  onEditorExit,
}: MemoryPickerOverlayProps): React.ReactElement {
  const sc = useSemanticColors();
  const colors = getPickerColors(sc, "active");
  const app = useApp();
  const [rows, setRows] = useState<MemoryRow[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [opening, setOpening] = useState(false);
  const autoEnabled = useMemo(() => isAutoMemoryEnabled(), []);

  // Async-load row state on mount.
  useEffect(() => {
    let cancelled = false;
    buildRows().then((built) => {
      if (cancelled) return;
      setRows(built);
      setSelectedIndex(initialIndex(built, initialSelection));
    });
    return () => {
      cancelled = true;
    };
  }, [initialSelection]);

  useInput((input: string, key) => {
    if (opening) return;
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i: number) => (i <= 0 ? rows.length - 1 : i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i: number) => (i + 1) % Math.max(rows.length, 1));
      return;
    }
    // Number-key shortcuts (1/2/3/4) — match the row order
    if (input === "1" && rows.length > 0) {
      setSelectedIndex(0);
      return;
    }
    if (input === "2" && rows.length > 1) {
      setSelectedIndex(1);
      return;
    }
    if (input === "3" && rows.length > 2) {
      setSelectedIndex(2);
      return;
    }
    if (input === "4" && rows.length > 3) {
      setSelectedIndex(3);
      return;
    }
    if (key.return) {
      if (rows.length === 0) return;
      const chosen = rows[selectedIndex];
      if (!chosen) return;
      setOpening(true);
      onClose();
      void (async () => {
        if (chosen.action === "open-folder") {
          // Ensure the folder exists, then ask the OS to reveal it.
          try {
            await getPlatform().fs.mkdir(chosen.path, { recursive: true });
          } catch {
            // ignore — openUrl will surface the error if the dir is missing
          }
          try {
            await getPlatform().openUrl(chosen.path);
          } catch {
            // best-effort
          }
          return;
        }
        const result = await editFileInEditorWithInkPause(app, chosen.path);
        if (onEditorExit) {
          try {
            onEditorExit(chosen.path, result.exitCode);
          } catch {
            // ignore
          }
        }
      })();
    }
  });

  const titleRight = autoEnabled
    ? "Auto-memory: on"
    : "Auto-memory: off (HLVM_DISABLE_AUTO_MEMORY=1)";

  return (
    <OverlayModal title="Memory" rightText={titleRight} width={width}>
      {rows.length === 0
        ? (
          <Box paddingY={1}>
            <Text color={sc.text.muted}>Loading…</Text>
          </Box>
        )
        : (
          <Box flexDirection="column">
            {rows.map((row: MemoryRow, i: number) => (
              <Box key={row.key}>
                <PickerRow
                  label={row.label}
                  isSelected={i === selectedIndex}
                  width={width - 4}
                  markerText={i === selectedIndex ? "›" : " "}
                  markerWidth={2}
                  metaText={row.description}
                  metaWidth={Math.max(20, Math.min(60, width - 24))}
                  pickerColors={colors}
                />
              </Box>
            ))}
          </Box>
        )}
      <Box marginTop={1}>
        <Text color={sc.text.muted}>
          ↑↓ select · Enter open · Esc cancel
        </Text>
      </Box>
    </OverlayModal>
  );
}
