/**
 * TurnStats Component
 *
 * Displays turn completion statistics as a styled separator.
 * Inspired by Gemini CLI's line separator pattern.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { formatDurationMs } from "../../utils/formatting.ts";

interface TurnStatsProps {
  toolCount: number;
  durationMs: number;
}

export function TurnStats({ toolCount, durationMs }: TurnStatsProps): React.ReactElement {
  const sc = useSemanticColors();
  const duration = formatDurationMs(durationMs);
  const tools = toolCount === 0 ? "" : toolCount === 1 ? "1 tool" : `${toolCount} tools`;
  const parts = [tools, duration].filter(Boolean).join(" · ");

  return (
    <Box marginY={1}>
      <Text color={sc.text.muted} dimColor>
        {`─── ${parts} ───`}
      </Text>
    </Box>
  );
}
