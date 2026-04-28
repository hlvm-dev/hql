/**
 * UserMessage Component
 *
 * Displays a user message as a full-width background block
 * for clear visual separation from assistant messages.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import type { ConversationAttachmentRef } from "../../types.ts";
import { getLiveConversationSpacing } from "../../utils/layout-tokens.ts";
import { TranscriptDivider } from "./TranscriptDivider.tsx";
import { truncateTranscriptInline } from "../../utils/transcript-truncation.ts";

const MAX_USER_MESSAGE_CHARS = 800;

interface UserMessageProps {
  text: string;
  attachments?: ConversationAttachmentRef[];
  width: number;
  compactSpacing?: boolean;
  showDividerBefore?: boolean;
}

export const UserMessage = React.memo(function UserMessage(
  {
    text,
    attachments,
    width,
    compactSpacing = false,
    showDividerBefore = false,
  }: UserMessageProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const spacing = getLiveConversationSpacing(compactSpacing);
  const displayText = truncateTranscriptInline(text, MAX_USER_MESSAGE_CHARS);
  const visibleAttachments = attachments?.filter((attachment) =>
    !displayText.includes(attachment.label)
  ) ?? [];
  const attachmentText = visibleAttachments.length > 0
    ? visibleAttachments.map((attachment) => attachment.label).join(" ")
    : "";

  return (
    <Box flexDirection="column" width={width}>
      {showDividerBefore && <TranscriptDivider width={width} />}
      <Box
        width={width}
        marginTop={spacing.userMessageMarginTop}
        marginBottom={spacing.userMessageMarginBottom}
        flexDirection="column"
        backgroundColor={sc.surface.userMessage}
        paddingRight={1}
      >
        <Text color={sc.text.primary} wrap="wrap">{displayText}</Text>
        {attachmentText && (
          <Text color={sc.text.secondary} wrap="wrap">
            {attachmentText}
          </Text>
        )}
      </Box>
    </Box>
  );
});
