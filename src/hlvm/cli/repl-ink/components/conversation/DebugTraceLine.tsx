import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import type { TracePresentationTone } from "../../../../agent/trace-presentation.ts";
import { TRANSCRIPT_LAYOUT } from "../../utils/layout-tokens.ts";

interface DebugTraceLineProps {
  text: string;
  depth: number;
  tone: TracePresentationTone;
}

function resolveToneColor(
  tone: TracePresentationTone,
  colors: ReturnType<typeof useSemanticColors>,
): string {
  switch (tone) {
    case "active":
      return colors.footer.status.active;
    case "warning":
      return colors.status.warning;
    case "error":
      return colors.status.error;
    case "muted":
    default:
      return colors.text.muted;
  }
}

export const DebugTraceLine = React.memo(function DebugTraceLine(
  { text, depth, tone }: DebugTraceLineProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const color = resolveToneColor(tone, sc);
  const indent = TRANSCRIPT_LAYOUT.detailIndent + Math.max(0, depth) * 2;
  const marker = depth > 0 ? "->" : "trace";

  return (
    <Box paddingLeft={indent}>
      <Text color={color} wrap="wrap">
        {marker} {text}
      </Text>
    </Box>
  );
});
