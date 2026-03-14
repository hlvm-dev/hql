/**
 * StreamingStatus Component
 *
 * Clean status line during AI streaming.
 * Pattern: Thinking... (5s • esc to interrupt)
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../../theme/index.ts";
import { formatElapsed } from "../utils/formatting.ts";

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

  // Time update while streaming
  useEffect(() => {
    if (!isStreaming) return;

    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 1000);

    return () => clearInterval(interval);
  }, [isStreaming, startTime]);

  if (!isStreaming) return null;

  const time = formatElapsed(elapsed);

  return (
    <Box>
      <Text color={color("muted")}>
        Thinking... ({time} • esc to interrupt)
      </Text>
    </Box>
  );
}
