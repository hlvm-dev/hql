/**
 * HLVM Update Banner — bordered notification when a newer version is available.
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
  const innerWidth = Math.max(20, getShellContentWidth(terminalWidth) - 6);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={sc.banner.status.attention}
      paddingX={1}
      marginBottom={1}
    >
      <Text>
        <Text color={sc.banner.logoStart}>{"✨ "}</Text>
        <Text color={sc.banner.status.attention} bold>
          {truncate(
            `Update available! ${update.current} → ${update.latest}`,
            innerWidth - 3,
            "…",
          )}
        </Text>
      </Text>
      <Text color={sc.text.primary}>
        {truncate(
          `Run \`${update.upgradeCommand}\` to update.`,
          innerWidth,
          "…",
        )}
      </Text>
      <Text />
      <Text color={sc.text.muted}>See full release notes:</Text>
      <Text color={sc.banner.logoEnd}>
        {truncate(update.releaseUrl, innerWidth, "…")}
      </Text>
    </Box>
  );
}
