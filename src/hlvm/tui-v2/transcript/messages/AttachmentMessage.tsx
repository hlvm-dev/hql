import React from "react";
import Box from "../../ink/components/Box.tsx";
import Text from "../../ink/components/Text.tsx";
import { MessageResponse } from "../../components/MessageResponse.tsx";
import { UserTextMessage } from "./UserTextMessage.tsx";

type Props = {
  title: string;
  attachmentType: string;
  attachmentPrompt?: string;
  lines: string[];
};

export function AttachmentMessage(
  { title, attachmentType, attachmentPrompt, lines }: Props,
): React.ReactNode {
  if (attachmentType === "queued_command" && attachmentPrompt) {
    return (
      <UserTextMessage
        title={title}
        lines={[attachmentPrompt, ...lines]}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="magenta">
        {title}
      </Text>
      <MessageResponse>
        <Box flexDirection="column">
          <Text dimColor>{attachmentType.replaceAll("_", " ")}</Text>
          {lines.map((line, index) => (
            <Text key={index} wrap="wrap">
              {line}
            </Text>
          ))}
        </Box>
      </MessageResponse>
    </Box>
  );
}
