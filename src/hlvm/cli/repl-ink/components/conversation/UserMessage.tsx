/**
 * UserMessage Component
 *
 * Displays a user message in the conversation.
 * Prefix `> ` with distinct styling for commands.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";

interface UserMessageProps {
  text: string;
  width: number;
}

export function UserMessage({ text, width }: UserMessageProps): React.ReactElement {
  const sc = useSemanticColors();

  return (
    <Box width={width} marginTop={1} marginBottom={1}>
      <Box width={3} flexShrink={0}>
        <Text color={sc.text.secondary} bold>
          {"> "}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text color={sc.text.secondary} wrap="wrap">
          {text}
        </Text>
      </Box>
    </Box>
  );
}
