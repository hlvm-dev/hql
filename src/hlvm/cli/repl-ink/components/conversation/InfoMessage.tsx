/**
 * InfoMessage Component
 *
 * Displays an informational message with muted styling.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";

interface InfoMessageProps {
  text: string;
}

export function InfoMessage({ text }: InfoMessageProps): React.ReactElement {
  const sc = useSemanticColors();

  return (
    <Box marginBottom={1} paddingLeft={1}>
      <Text color={sc.text.muted}>ℹ </Text>
      <Text color={sc.text.muted} wrap="wrap">{text}</Text>
    </Box>
  );
}
