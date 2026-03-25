/**
 * InfoMessage Component
 *
 * Displays an informational message with icon prefix, flat text (no box).
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { STATUS_GLYPHS } from "../../ui-constants.ts";

interface InfoMessageProps {
  text: string;
}

export const InfoMessage = React.memo(
  function InfoMessage({ text }: InfoMessageProps): React.ReactElement {
    const sc = useSemanticColors();
    return (
      <Box paddingLeft={2} marginBottom={1}>
        <Text color={sc.text.muted}>{STATUS_GLYPHS.info} {text}</Text>
      </Box>
    );
  },
);
