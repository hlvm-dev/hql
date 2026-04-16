import React from "react";
import Box from "../../ink/components/Box.tsx";
import Text from "../../ink/components/Text.tsx";
import { MessageResponse } from "../../components/MessageResponse.tsx";
import {
  primaryToolInputLabel,
  primaryToolInputValue,
} from "../compat/messageActions.ts";
import type { TranscriptToolCall } from "../types.ts";

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
      {lines.length > 0 && (
        <MessageResponse>
          <Box flexDirection="column">
            {lines.map((line, index) => (
              <Text key={index} wrap="wrap">
                {line}
              </Text>
            ))}
          </Box>
        </MessageResponse>
      )}
    </Box>
  );
}
