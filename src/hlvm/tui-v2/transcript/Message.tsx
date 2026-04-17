import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import { MessageResponse } from "../components/MessageResponse.tsx";
import {
  AssistantResponse,
  AssistantTextMessage,
} from "./messages/AssistantTextMessage.tsx";
import { AttachmentMessage } from "./messages/AttachmentMessage.tsx";
import { AssistantThinkingMessage } from "./messages/AssistantThinkingMessage.tsx";
import { GroupedToolUseContent } from "./messages/GroupedToolUseContent.tsx";
import { SystemTextMessage } from "./messages/SystemTextMessage.tsx";
import { UserTextMessage } from "./messages/UserTextMessage.tsx";
import type { RenderableTranscriptMessage } from "./types.ts";

type Props = {
  message: RenderableTranscriptMessage;
  verbose?: boolean;
};

export function Message(
  { message, verbose = false }: Props,
): React.ReactNode {
  const body = renderBody(message, verbose);
  if (!body) return null;
  return <Box flexDirection="column" marginTop={1}>{body}</Box>;
}

function renderBody(
  message: RenderableTranscriptMessage,
  verbose: boolean,
): React.ReactNode {
  switch (message.type) {
    case "user":
      return <UserTextMessage title={message.title} lines={message.lines} />;
    case "assistant":
      return (
        <Box flexDirection="column">
          <AssistantTextMessage text={message.title} />
          <AssistantResponse lines={message.lines} />
        </Box>
      );
    case "grouped_tool_use":
      return (
        <GroupedToolUseContent
          title={message.title}
          toolName={message.toolName}
          toolCall={message.toolCall}
          lines={message.lines}
        />
      );
    case "collapsed_read_search":
      return (
        <Box flexDirection="column">
          <Text dimColor>{message.title}</Text>
          <MessageResponse>
            <Box flexDirection="column">
              {message.lines.map((line, index) => (
                <Text key={index} wrap="wrap">
                  {line}
                </Text>
              ))}
              {message.relevantMemories &&
                message.relevantMemories.length > 0 && (
                <Text dimColor>
                  recalled {message.relevantMemories.length} memories
                </Text>
              )}
            </Box>
          </MessageResponse>
        </Box>
      );
    case "system":
      return (
        <SystemTextMessage
          title={message.title}
          lines={message.lines}
          verbose={verbose}
        />
      );
    case "thinking":
      return (
        <AssistantThinkingMessage
          thinking={message.thinking}
          kind={message.kind}
          verbose={verbose}
        />
      );
    case "attachment":
      return (
        <AttachmentMessage
          title={message.title}
          attachmentType={message.attachmentType}
          attachmentPrompt={message.attachmentPrompt}
          lines={message.lines}
        />
      );
  }
}
