/**
 * ErrorMessage Component
 *
 * Displays an error message with icon and error color.
 * Wraps text for readability.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { STATUS_GLYPHS } from "../../ui-constants.ts";
import { ConversationCallout } from "./ConversationCallout.tsx";

interface ErrorMessageProps {
  text: string;
}

export const ErrorMessage = React.memo(
  function ErrorMessage({ text }: ErrorMessageProps): React.ReactElement {
    const sc = useSemanticColors();

    return (
      <ConversationCallout
        title={`${STATUS_GLYPHS.error} Error`}
        tone="error"
      >
        <Box marginTop={0}>
          <Text color={sc.status.error} wrap="wrap">{text}</Text>
        </Box>
      </ConversationCallout>
    );
  },
);
