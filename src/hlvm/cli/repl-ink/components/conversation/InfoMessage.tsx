/**
 * InfoMessage Component
 *
 * Displays an informational message with muted styling.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { STATUS_GLYPHS } from "../../ui-constants.ts";
import { ConversationCallout } from "./ConversationCallout.tsx";

interface InfoMessageProps {
  text: string;
}

export const InfoMessage = React.memo(
  function InfoMessage({ text }: InfoMessageProps): React.ReactElement {
    const sc = useSemanticColors();

    return (
      <ConversationCallout
        title={`${STATUS_GLYPHS.info} Info`}
        tone="neutral"
      >
        <Box marginTop={0}>
          <Text color={sc.text.muted} wrap="wrap">{text}</Text>
        </Box>
      </ConversationCallout>
    );
  },
);
