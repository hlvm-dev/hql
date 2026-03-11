/**
 * ErrorMessage Component
 *
 * Displays an error message with icon and error color.
 * Wraps text for readability.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";

interface ErrorMessageProps {
  text: string;
}

export const ErrorMessage = React.memo(function ErrorMessage({ text }: ErrorMessageProps): React.ReactElement {
  const sc = useSemanticColors();

  return (
    <Box
      marginBottom={1}
      borderStyle="single"
      borderLeft
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderColor={sc.status.error}
      paddingLeft={1}
    >
      <Text color={sc.status.error} bold>✗ </Text>
      <Text color={sc.status.error} wrap="wrap">{text}</Text>
    </Box>
  );
});
