/**
 * HLVM Update Banner — compact notification when a newer version is available.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import type { UpdateInfo } from "../../utils/update-check.ts";
import { useSemanticColors } from "../../theme/index.ts";
import { truncate } from "../../../../common/utils.ts";
import { getShellContentWidth } from "../utils/layout-tokens.ts";
import { DEFAULT_TERMINAL_WIDTH } from "../ui-constants.ts";

export function UpdateBanner(
  { update }: { update: UpdateInfo },
): React.ReactElement {
  const { stdout } = useStdout();
  const sc = useSemanticColors();
  const terminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  const innerWidth = Math.max(20, getShellContentWidth(terminalWidth));
  const line = `Update ${update.current} → ${update.latest} · ${update.updateCommand} · ${update.releaseUrl}`;

  return (
    <Box>
      <Text>
        <Text color={sc.banner.status.attention} bold>Update</Text>
        <Text color={sc.text.muted}>
          {" "}
          {truncate(line.replace(/^Update\s+/, ""), innerWidth - 7, "…")}
        </Text>
      </Text>
    </Box>
  );
}
