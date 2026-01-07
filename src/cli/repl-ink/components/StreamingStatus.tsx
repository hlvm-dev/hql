/**
 * StreamingStatus Component
 *
 * Claude Code CLI-style status line during AI streaming.
 * Pattern: ✳ Thinking… (esc to interrupt · 4m 35s)
 */

import React, { useState, useEffect, useMemo } from "npm:react@18";
import { Box, Text } from "npm:ink@5";

// Braille spinner frames (smooth animation)
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Claude-style status words
const STATUS_WORDS = ["Thinking…", "Tinkering…", "Whisking…", "Pondering…"];

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
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // Pick a random status word once per streaming session
  const statusWord = useMemo(() => {
    return STATUS_WORDS[Math.floor(Math.random() * STATUS_WORDS.length)];
  }, [startTime]);

  // Spinner animation and time update
  useEffect(() => {
    if (!isStreaming) return;

    const interval = setInterval(() => {
      setFrame((f: number) => (f + 1) % SPINNER_FRAMES.length);
      setElapsed(Date.now() - startTime);
    }, 80);

    return () => clearInterval(interval);
  }, [isStreaming, startTime]);

  if (!isStreaming) return null;

  const spinner = SPINNER_FRAMES[frame];
  const time = formatElapsed(elapsed);

  return (
    <Box>
      <Text color="#663399">{spinner}</Text>
      <Text color="yellow"> {statusWord} </Text>
      <Text dimColor>(esc to interrupt · {time})</Text>
    </Box>
  );
}
