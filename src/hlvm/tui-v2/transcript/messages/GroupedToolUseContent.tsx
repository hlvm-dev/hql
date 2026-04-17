import React from "react";
import Box from "../../ink/components/Box.tsx";
import Text from "../../ink/components/Text.tsx";
import { MessageResponse } from "../../components/MessageResponse.tsx";
import {
  primaryToolInputLabel,
  primaryToolInputValue,
} from "../compat/messageActions.ts";
import type { TranscriptToolCall } from "../types.ts";

// CC parity: tool output rows in `~/dev/ClaudeCode-main/` render a compact
// summary and suppress long output with a `(ctrl+o to expand)` hint. v2
// previously dumped every output line inline, so an `ls` or `grep` would
// balloon the transcript. Clamp to a small preview here; full output lives
// in the transcript viewer (ctrl+o — TODO: wire overlay).
const COLLAPSED_PREVIEW_LINES = 3;

type Props = {
  title: string;
  toolName: string;
  toolCall?: TranscriptToolCall;
  lines: string[];
};

export function GroupedToolUseContent(
  { title, toolName, toolCall, lines }: Props,
): React.ReactNode {
  const label = primaryToolInputLabel(toolName);
  const value = primaryToolInputValue(toolName, toolCall?.input ?? {});
  const visibleLines = lines.slice(0, COLLAPSED_PREVIEW_LINES);
  const hiddenLineCount = Math.max(0, lines.length - visibleLines.length);

  return (
    <Box flexDirection="column">
      <Text bold color="yellow">
        {title}
      </Text>
      {label && value && (
        <MessageResponse>
          <Text color="yellow" wrap="wrap">
            {label}: {value}
          </Text>
        </MessageResponse>
      )}
      {visibleLines.length > 0 && (
        <MessageResponse>
          <Box flexDirection="column">
            {visibleLines.map((line, index) => (
              <Text key={index} wrap="wrap">
                {line}
              </Text>
            ))}
            {hiddenLineCount > 0 && (
              <Text dimColor>
                … +{hiddenLineCount} more line{hiddenLineCount === 1 ? "" : "s"}
                {" "}(ctrl+o to expand)
              </Text>
            )}
          </Box>
        </MessageResponse>
      )}
    </Box>
  );
}
