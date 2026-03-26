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
import { getLiveConversationSpacing } from "./message-spacing.ts";

interface UserMessageProps {
  text: string;
  attachments?: ConversationAttachmentRef[];
  width: number;
  compactSpacing?: boolean;
}

export const UserMessage = React.memo(function UserMessage(
  { text, attachments, width, compactSpacing = false }: UserMessageProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const spacing = getLiveConversationSpacing(compactSpacing);
  const attachmentText = attachments && attachments.length > 0
    ? attachments.map((attachment) => attachment.label).join(" ")
    : "";

  return (
    <Box
      width={width}
      marginTop={spacing.userMessageMarginTop}
      marginBottom={spacing.userMessageMarginBottom}
      flexDirection="column"
    >
      <Box>
        <Text color={sc.status.success} bold>{"> "}</Text>
        <Text color={sc.text.primary}>{text}</Text>
      </Box>
      {attachmentText && (
        <Text color={sc.text.secondary} wrap="wrap">
          {"  "}
          {attachmentText}
        </Text>
      )}
    </Box>
  );
});
