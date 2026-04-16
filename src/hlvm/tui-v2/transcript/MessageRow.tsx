import React from "react";
import Box from "../ink/components/Box.tsx";
import { Message } from "./Message.tsx";
import { useSelectedMessageBg } from "./compat/messageActions.ts";
import type { RenderableTranscriptMessage } from "./types.ts";

type Props = {
  message: RenderableTranscriptMessage;
  index: number;
  expanded: boolean;
};

export function MessageRow(
  { message, index: _index, expanded: _expanded }: Props,
): React.ReactNode {
  const backgroundColor = useSelectedMessageBg();

  return (
    <Box
      flexDirection="column"
      marginBottom={1}
      backgroundColor={backgroundColor}
    >
      <Message message={message} />
    </Box>
  );
}
