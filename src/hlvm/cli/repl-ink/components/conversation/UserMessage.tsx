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
import { ChromeChip } from "../ChromeChip.tsx";
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
  const attachmentText = attachments && attachments.length > 0
    ? attachments.map((attachment) => attachment.label).join(" ")
    : "";

  return (
    <Box flexDirection="column" width={width}>
      {showDividerBefore && <TranscriptDivider width={width} />}
      <Box
        width={width}
        marginTop={spacing.userMessageMarginTop}
        marginBottom={spacing.userMessageMarginBottom}
        flexDirection="column"
      >
        <Box>
          <ChromeChip text={displayText} tone="neutral" />
        </Box>
        {attachmentText && (
          <Text color={sc.text.secondary} wrap="wrap">
            {"  "}
            {attachmentText}
          </Text>
        )}
      </Box>
    </Box>
  );
});
