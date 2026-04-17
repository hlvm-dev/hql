import React from "react";
import Box from "../../ink/components/Box.tsx";
import { NoSelect } from "../../ink/components/NoSelect.tsx";
import Text from "../../ink/components/Text.tsx";
import type { TranscriptToolCall } from "../types.ts";

const COLLAPSED_PREVIEW_LINES = 3;
const BULLET = "⏺";
const TREE_CORNER = "⎿";

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
        {visibleLines.length > 0 && (
          <Box flexDirection="column" marginLeft={2}>
            {visibleLines.map((line, index) => (
              <Box key={index} flexDirection="row">
                <Box minWidth={2}>
                  <Text dimColor>{index === 0 ? TREE_CORNER : " "}</Text>
                </Box>
                <Box flexGrow={1}>
                  <Text wrap="wrap">{line}</Text>
                </Box>
              </Box>
            ))}
            {hiddenLineCount > 0 && (
              <Box flexDirection="row">
                <Box minWidth={2}>
                  <Text dimColor> </Text>
                </Box>
                <Text dimColor>
                  … +{hiddenLineCount} more line{hiddenLineCount === 1 ? "" : "s"}
                  {" "}(ctrl+o to expand)
                </Text>
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
