/**
 * StreamingStatus Component
 *
 * Clean status line during AI streaming.
 * Uses static marker — no animated spinner avoids terminal redraws
 * that break text selection. The footer shows spinner activity instead.
 */

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../../theme/index.ts";
import { STATUS_GLYPHS } from "../ui-constants.ts";

interface StreamingStatusProps {
  isStreaming: boolean;
  startTime: number;
}

export const StreamingStatus = React.memo(function StreamingStatus({
  isStreaming,
}: StreamingStatusProps): React.ReactElement | null {
  const { color } = useTheme();

  if (!isStreaming) return null;

  return (
    <Box>
      <Text color={color("muted")}>
        {STATUS_GLYPHS.running} Thinking... (esc to interrupt)
      </Text>
    </Box>
  );
});
