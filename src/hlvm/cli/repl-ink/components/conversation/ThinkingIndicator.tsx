/**
 * Renders persisted reasoning/planning transcript entries.
 *
 * The active row shows a clean text indicator; historical rows stay static.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { useConversationSpinnerFrame } from "../../hooks/useConversationMotion.ts";
import { STATUS_GLYPHS } from "../../ui-constants.ts";

interface ThinkingIndicatorProps {
  kind: "reasoning" | "planning";
  summary: string;
  iteration: number;
  expanded?: boolean;
  /** Disable animation when the stream is paused (e.g. waiting for permission) */
  isAnimating?: boolean;
}

export const ThinkingIndicator = React.memo(function ThinkingIndicator({
  kind,
  summary,
  iteration,
  expanded = false,
  isAnimating = true,
}: ThinkingIndicatorProps): React.ReactElement {
  const sc = useSemanticColors();
  const spinnerFrame = useConversationSpinnerFrame(isAnimating);
  const marker = isAnimating
    ? (spinnerFrame ?? STATUS_GLYPHS.running)
    : STATUS_GLYPHS.pending;
  const lines = summary ? summary.split("\n") : [];
  const maxBodyLines = expanded ? lines.length : 0;
  const visibleBodyLines = lines.slice(0, maxBodyLines);
  const hiddenBodyLineCount = Math.max(
    0,
    lines.length - visibleBodyLines.length,
  );
  const body = visibleBodyLines.join("\n").trim();
  const title = kind === "reasoning" ? "Thinking" : "Planning";

  return (
    <Box paddingLeft={1} flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={sc.status.warning}>{`${marker} `}</Text>
        <Text color={sc.status.warning} bold>
          {title}
        </Text>
        {iteration > 1 && (
          <Text color={sc.text.muted}>{` (${iteration})`}</Text>
        )}
      </Box>
      {body && (
        <Box
          paddingLeft={3}
          flexDirection="column"
        >
          <Text color={sc.text.secondary} italic wrap="wrap">
            {body}
          </Text>
        </Box>
      )}
      {expanded && hiddenBodyLineCount > 0 && (
        <Box marginLeft={3}>
          <Text color={sc.text.muted}>
            ... ({hiddenBodyLineCount} more lines)
          </Text>
        </Box>
      )}
    </Box>
  );
});
