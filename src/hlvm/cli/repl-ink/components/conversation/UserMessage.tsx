/**
 * UserMessage Component
 *
 * Displays a user message in the conversation.
 * Clear ">" marker for strong role differentiation.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import type { ConversationAttachmentRef } from "../../types.ts";

interface UserMessageProps {
  text: string;
  attachments?: ConversationAttachmentRef[];
  width: number;
}

export const UserMessage = React.memo(function UserMessage(
  { text, attachments, width }: UserMessageProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const attachmentText = attachments && attachments.length > 0
    ? attachments.map((attachment) => attachment.label).join(" ")
    : "";

  return (
    <Box width={width} marginTop={1} marginBottom={1} flexDirection="column">
      <Box>
        <Text color={sc.status.success} bold>{"> "}</Text>
        <Text color={sc.text.primary}>{text}</Text>
      </Box>
      {attachmentText && (
        <Text color={sc.text.secondary} wrap="wrap">
          {"  "}{attachmentText}
        </Text>
      )}
    </Box>
  );
});
