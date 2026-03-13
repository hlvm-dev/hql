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
  attachments?: string[];
  width: number;
}

export const UserMessage = React.memo(function UserMessage(
  { text, attachments, width }: UserMessageProps,
): React.ReactElement {
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
        flexDirection="column"
      >
        <Box>
          <Text color={sc.status.success} bold>{">"}</Text>
          <Text color={sc.text.primary}>{text}</Text>
        </Box>
        {attachments && attachments.length > 0
          ? <Text color={sc.text.secondary}>{attachments.join(" ")}</Text>
          : null}
      </Box>
    </Box>
  );
});
