/**
 * ThinkingIndicator Component
 *
 * Shows a thinking/reasoning indicator with spinner.
 * Follows Gemini pattern: first line as subject, rest as body with left border.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import {
  BRAILLE_SPINNER_FRAMES,
  TOGGLE_LATEST_HINT,
} from "../../ui-constants.ts";
import { useSpinnerFrame } from "../../hooks/useSpinnerFrame.ts";

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
  const frame = useSpinnerFrame(isAnimating);
  const lines = summary ? summary.split("\n") : [];
  const maxBodyLines = expanded ? lines.length : 3;
  const visibleBodyLines = lines.slice(0, maxBodyLines);
  const hiddenBodyLineCount = Math.max(
    0,
    lines.length - visibleBodyLines.length,
  );
  const body = visibleBodyLines.join("\n").trim();
  const title = kind === "reasoning" ? "Reasoning" : "Planning";

  return (
    <Box paddingLeft={1} flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={sc.status.warning}>{BRAILLE_SPINNER_FRAMES[frame]}</Text>
        <Text color={sc.status.warning} bold>
          {title}
        </Text>
        {iteration > 1 && <Text color={sc.text.muted}>({iteration})</Text>}
      </Box>
      {body && (
        <Box
          borderStyle="single"
          borderLeft
          borderRight={false}
          borderTop={false}
          borderBottom={false}
          borderColor={sc.border.default}
          paddingLeft={1}
          marginLeft={2}
        >
          <Text color={sc.text.secondary} italic wrap="wrap">
            {body}
          </Text>
        </Box>
      )}
      {hiddenBodyLineCount > 0 && (
        <Box marginLeft={2}>
          <Text color={sc.text.muted}>
            … ({hiddenBodyLineCount} more lines · {TOGGLE_LATEST_HINT})
          </Text>
        </Box>
      )}
    </Box>
  );
});
