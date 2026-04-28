/**
 * MemoryUpdateNotification — inline transcript line shown after the model
 * writes or edits a memory file. Mirrors CC's behavior:
 *
 *   Memory updated in ~/.hlvm/HLVM.md · /memory to edit
 *
 * One line, dim text, never expandable.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { TRANSCRIPT_LAYOUT } from "../../utils/layout-tokens.ts";
import { getPlatform } from "../../../../../platform/platform.ts";

interface MemoryUpdateNotificationProps {
  path: string;
}

/** Shorten a path for display: collapse $HOME → ~ if present. */
function displayPath(path: string): string {
  const home = getPlatform().env.get("HOME") ?? "";
  if (home && path.startsWith(home + "/")) {
    return "~" + path.slice(home.length);
  }
  return path;
}

export const MemoryUpdateNotification = React.memo(
  function MemoryUpdateNotification(
    { path }: MemoryUpdateNotificationProps,
  ): React.ReactElement {
    const sc = useSemanticColors();
    return (
      <Box paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}>
        <Text color={sc.text.muted}>
          Memory updated in {displayPath(path)} · /memory to edit
        </Text>
      </Box>
    );
  },
);
