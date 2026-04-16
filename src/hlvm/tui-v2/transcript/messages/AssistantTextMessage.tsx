import React from "react";
import Box from "../../ink/components/Box.tsx";
import { NoSelect } from "../../ink/components/NoSelect.tsx";
import Text from "../../ink/components/Text.tsx";
import { Markdown } from "../../markdown/Markdown.tsx";
import { MessageResponse } from "../../components/MessageResponse.tsx";
import { DONOR_TEXT } from "../../theme/donorTheme.ts";

type Props = {
  text: string;
  shouldShowDot?: boolean;
};

export function AssistantTextMessage(
  { text, shouldShowDot = true }: Props,
): React.ReactNode {
  return (
    <Box flexDirection="row">
      <NoSelect fromLeftEdge minWidth={2}>
        {shouldShowDot ? <Text color={DONOR_TEXT}>⏺</Text> : <Text></Text>}
      </NoSelect>
      <Box flexDirection="column" flexGrow={1}>
        <Markdown children={text} />
      </Box>
    </Box>
  );
}

type ResponseProps = {
  lines: string[];
};

export function AssistantResponse({ lines }: ResponseProps): React.ReactNode {
  if (lines.length === 0) return null;
  return (
    <MessageResponse>
      <Box flexDirection="column">
        {lines.map((line, index) => (
          <Text key={index} wrap="wrap">
            {line}
          </Text>
        ))}
      </Box>
    </MessageResponse>
  );
}
