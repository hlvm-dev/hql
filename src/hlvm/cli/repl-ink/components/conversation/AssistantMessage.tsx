/**
 * AssistantMessage Component
 *
 * Displays an assistant (model) response with React markdown rendering.
 * Prefix: ✦ in accent color (inspired by Gemini CLI).
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { MarkdownDisplay } from "../markdown/index.ts";

interface AssistantMessageProps {
  text: string;
  isPending: boolean;
  width: number;
}

export function AssistantMessage(
  { text, isPending, width }: AssistantMessageProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const contentWidth = Math.max(10, width - 3);

  return (
    <Box flexDirection="row" width={width} marginBottom={1}>
      <Box width={3} flexShrink={0}>
        <Text color={sc.status.success} bold>✦ </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <MarkdownDisplay text={text} width={contentWidth} isPending={isPending} />
        {isPending && (
          <Text color={sc.text.muted}>...</Text>
        )}
      </Box>
    </Box>
  );
}
