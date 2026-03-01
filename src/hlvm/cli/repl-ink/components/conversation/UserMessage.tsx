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
  const isCmd = text.startsWith("/");

  return (
    <Box width={width} marginTop={1} marginBottom={1}>
      <Box width={3} flexShrink={0}>
        <Text color={isCmd ? sc.status.success : sc.text.primary} bold>
          {"> "}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text color={isCmd ? sc.status.success : sc.text.primary} bold wrap="wrap">
          {text}
        </Text>
      </Box>
    </Box>
  );
}
