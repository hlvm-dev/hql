/**
 * StreamingStatus Component
 *
 * Clean status line during AI streaming.
 * Pattern: Thinking... (5s • esc to interrupt)
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../../theme/index.ts";

interface StreamingStatusProps {
  isStreaming: boolean;
  startTime: number;
}

/**
 * Format elapsed time: "5s", "1m 30s", "1h 5m"
 */
function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
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
