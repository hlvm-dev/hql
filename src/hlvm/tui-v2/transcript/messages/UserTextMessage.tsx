import React from "react";
import Box from "../../ink/components/Box.tsx";
import Text from "../../ink/components/Text.tsx";
import {
  DONOR_SUBTLE,
  DONOR_TEXT,
  DONOR_USER_MESSAGE_BACKGROUND,
} from "../../theme/donorTheme.ts";

type Props = {
  title?: string;
  lines: string[];
  isContinuation?: boolean;
};

export function UserTextMessage(
  { title, lines, isContinuation = false }: Props,
): React.ReactNode {
  const contentLines = lines.length > 0 ? lines : title ? [title] : [];

  if (contentLines.length === 0) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      backgroundColor={DONOR_USER_MESSAGE_BACKGROUND}
      paddingRight={1}
    >
      {contentLines.map((line, index) => (
        <Text key={index} wrap="wrap">
          {!isContinuation && index === 0 && (
            <Text color={DONOR_SUBTLE}>❯ </Text>
          )}
          <Text color={DONOR_TEXT}>{line}</Text>
        </Text>
      ))}
    </Box>
  );
}
