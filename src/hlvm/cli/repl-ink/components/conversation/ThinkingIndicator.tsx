/**
 * ThinkingIndicator Component
 *
 * Shows a thinking/reasoning indicator with spinner.
 * Follows Gemini pattern: first line as subject, rest as body with left border.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { BRAILLE_SPINNER_FRAMES } from "../../ui-constants.ts";
import { useSpinnerFrame } from "../../hooks/useSpinnerFrame.ts";

interface ThinkingIndicatorProps {
  summary: string;
  iteration: number;
  expanded?: boolean;
}

export function ThinkingIndicator({
  summary,
  iteration,
  expanded = false,
}: ThinkingIndicatorProps): React.ReactElement {
  const sc = useSemanticColors();
  const frame = useSpinnerFrame(true);

  // Split summary into subject (first line) and body (rest) — Gemini pattern
  const lines = summary ? summary.split("\n") : [];
  const subject = lines[0] || "";
  const bodyLines = lines.slice(1);
  const maxBodyLines = expanded ? bodyLines.length : 3;
  const visibleBodyLines = bodyLines.slice(0, maxBodyLines);
  const hiddenBodyLineCount = Math.max(0, bodyLines.length - visibleBodyLines.length);
  const body = visibleBodyLines.join("\n").trim();

  return (
    <Box paddingLeft={1} flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={sc.status.warning}>{BRAILLE_SPINNER_FRAMES[frame]} </Text>
        <Text color={sc.text.primary} bold italic>
          {subject || `Thinking${iteration > 1 ? ` (${iteration})` : ""}`}
        </Text>
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
            … ({hiddenBodyLineCount} more lines · Ctrl+O to expand, empty prompt)
          </Text>
        </Box>
      )}
    </Box>
  );
}
