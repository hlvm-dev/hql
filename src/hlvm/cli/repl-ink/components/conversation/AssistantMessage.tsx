/**
 * AssistantMessage Component
 *
 * Displays an assistant (model) response with markdown rendering.
 * Shows a streaming cursor when isPending.
 * Prefix: ✦ in accent color (inspired by Gemini CLI).
 */

import React, { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { renderMarkdown } from "../../../repl/markdown.ts";

const CURSOR_FRAMES = ["▍", "▌", "▋", "█"];
const CURSOR_INTERVAL_MS = 150;

interface AssistantMessageProps {
  text: string;
  isPending: boolean;
  width: number;
}

export function AssistantMessage({ text, isPending, width }: AssistantMessageProps): React.ReactElement {
  const sc = useSemanticColors();
  const [cursorFrame, setCursorFrame] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cursor animation — use ref to avoid interval churn on re-renders
  useEffect(() => {
    if (isPending && !intervalRef.current) {
      intervalRef.current = setInterval(() => {
        setCursorFrame((f: number) => (f + 1) % CURSOR_FRAMES.length);
      }, CURSOR_INTERVAL_MS);
    } else if (!isPending && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
      setCursorFrame(0);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPending]);

  // Prefix takes 2 chars ("✦ "), leave rest for content
  const contentWidth = Math.max(10, width - 3);
  const rendered = text ? renderMarkdown(text, contentWidth) : "";

  return (
    <Box flexDirection="row" width={width} marginBottom={1}>
      {/* Prefix: accent diamond */}
      <Box width={3} flexShrink={0}>
        <Text color={sc.status.success} bold>✦ </Text>
      </Box>
      {/* Content */}
      <Box flexDirection="column" flexGrow={1}>
        {rendered && (
          <Box>
            <Text wrap="wrap">{rendered}</Text>
          </Box>
        )}
        {isPending && (
          <Box>
            <Text color={sc.text.muted}>
              {text ? "" : "Generating..."}{CURSOR_FRAMES[cursorFrame]}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
