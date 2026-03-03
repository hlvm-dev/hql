/**
 * UserMessage Component
 *
 * Displays a user message in the conversation.
 * Clear "You" marker for strong role differentiation.
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
  const contentWidth = Math.max(10, width - 6);

  return (
    <Box width={width} marginTop={1} marginBottom={1}>
      <Box
        borderStyle="single"
        borderLeft
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderColor={sc.border.active}
        paddingLeft={1}
        width={contentWidth}
      >
        <Text color={sc.status.success} bold>{">"}</Text>
        <Text color={sc.text.primary}> {text}</Text>
      </Box>
    </Box>
  );
}
