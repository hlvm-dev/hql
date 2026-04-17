import React from "react";
import Box from "../../ink/components/Box.tsx";
import { NoSelect } from "../../ink/components/NoSelect.tsx";
import Text from "../../ink/components/Text.tsx";
import type { TranscriptToolCall } from "../types.ts";

const COLLAPSED_PREVIEW_LINES = 3;
const BULLET = "⏺";
const CORNER_PREFIX = "⎿  ";
const CONTINUATION_PREFIX = "   ";

type Props = {
  title: string;
  toolName: string;
  toolCall?: TranscriptToolCall;
  lines: string[];
};

export function GroupedToolUseContent(
  { title, lines }: Props,
): React.ReactNode {
  const visibleLines = lines.slice(0, COLLAPSED_PREVIEW_LINES);
  const hiddenLineCount = Math.max(0, lines.length - visibleLines.length);

  return (
    <Box flexDirection="row">
      <NoSelect fromLeftEdge minWidth={2}>
        <Text>{BULLET}</Text>
      </NoSelect>
      <Box flexDirection="column" flexGrow={1}>
        <Text bold wrap="truncate-end">{title}</Text>
        {visibleLines.map((line, index) => (
          <Text key={index} wrap="wrap">
            {index === 0 ? CORNER_PREFIX : CONTINUATION_PREFIX}{line}
          </Text>
        ))}
        {hiddenLineCount > 0 && (
          <Text dimColor>
            {CONTINUATION_PREFIX}… +{hiddenLineCount} more line
            {hiddenLineCount === 1 ? "" : "s"} (ctrl+o to expand)
          </Text>
        )}
      </Box>
    </Box>
  );
}
