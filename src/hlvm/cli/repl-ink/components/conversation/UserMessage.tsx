import React from "react";
import { Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { ConversationSection } from "./ConversationSection.tsx";

interface UserMessageProps {
  text: string;
  attachments?: string[];
  width: number;
}

export const UserMessage = React.memo(function UserMessage(
  { text, attachments, width }: UserMessageProps,
): React.ReactElement {
  const sc = useSemanticColors();

  return (
    <ConversationSection
      title="You"
      titleColor={sc.border.active}
      accentColor={sc.border.active}
      width={width}
      marginTop={1}
    >
      <Text color={sc.text.primary} wrap="wrap">
        {text}
      </Text>
      {attachments && attachments.length > 0
        ? (
          <Text color={sc.text.secondary} wrap="wrap">
            {attachments.join(" ")}
          </Text>
        )
        : null}
    </ConversationSection>
  );
});
