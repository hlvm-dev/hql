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
import { SPINNER_FRAMES, STATUS_GLYPHS } from "../ui-constants.ts";
import { useConversationSpinnerFrame } from "../hooks/useConversationMotion.ts";

interface StreamingStatusProps {
  isStreaming: boolean;
}

export const StreamingStatus = React.memo(function StreamingStatus({
  isStreaming,
}: StreamingStatusProps): React.ReactElement | null {
  const { color } = useTheme();
  const spinner = useConversationSpinnerFrame(isStreaming);

  if (!isStreaming) return null;

  const spinnerIndex = spinner
    ? SPINNER_FRAMES.indexOf(spinner as (typeof SPINNER_FRAMES)[number])
    : -1;
  const verbs = ["Orchestrating", "Planning", "Analyzing", "Working"];
  const verb = spinnerIndex >= 0
    ? verbs[spinnerIndex % verbs.length]!
    : "Working";

  return (
    <Box>
      <Text color={color("muted")}>
        {spinner ?? STATUS_GLYPHS.running} {verb}... (esc to interrupt)
      </Text>
    </Box>
  );
});
