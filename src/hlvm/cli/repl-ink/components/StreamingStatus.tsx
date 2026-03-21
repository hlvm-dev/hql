/**
 * StreamingStatus Component
 *
 * Clean status line during AI streaming.
 * Pattern: Thinking... (5s • esc to interrupt)
 */

import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../../theme/index.ts";
import { formatElapsed } from "../utils/formatting.ts";
import { useConversationSpinnerFrame } from "../hooks/useConversationMotion.ts";
import { STATUS_GLYPHS } from "../ui-constants.ts";

interface StreamingStatusProps {
  isStreaming: boolean;
  startTime: number;
}

export function StreamingStatus({
  isStreaming,
  startTime,
}: StreamingStatusProps): React.ReactElement | null {
  const { color } = useTheme();
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef(startTime);
  const spinnerFrame = useConversationSpinnerFrame(isStreaming);
  startTimeRef.current = startTime;

  // Time update while streaming — ref avoids interval restart on startTime change
  useEffect(() => {
    if (!isStreaming) return;

    const interval = setInterval(() => {
      setElapsed(Date.now() - startTimeRef.current);
    }, 1000);

    return () => clearInterval(interval);
  }, [isStreaming]);

  if (!isStreaming) return null;

  const time = formatElapsed(elapsed);

  return (
    <Box>
      <Text color={color("muted")}>
        {spinnerFrame ?? STATUS_GLYPHS.running} Thinking... ({time} • esc to interrupt)
      </Text>
    </Box>
  );
}
