/**
 * ErrorMessage Component
 *
 * Displays an error message with icon prefix, flat text (no box).
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { STATUS_GLYPHS } from "../../ui-constants.ts";

interface ErrorMessageProps {
  text: string;
}

export const ErrorMessage = React.memo(
  function ErrorMessage({ text }: ErrorMessageProps): React.ReactElement {
    const sc = useSemanticColors();
    return (
      <Box paddingLeft={2} marginBottom={1}>
        <Text color={sc.status.error}>{STATUS_GLYPHS.error} {text}</Text>
      </Box>
    );
  },
);
