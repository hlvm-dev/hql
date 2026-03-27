/**
 * InfoMessage Component
 *
 * Displays an informational message with icon prefix, flat text (no box).
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { STATUS_GLYPHS } from "../../ui-constants.ts";
import { TRANSCRIPT_LAYOUT } from "../../utils/layout-tokens.ts";

interface InfoMessageProps {
  text: string;
}

export const InfoMessage = React.memo(
  function InfoMessage({ text }: InfoMessageProps): React.ReactElement {
    const sc = useSemanticColors();
    return (
      <Box
        paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
        marginBottom={1}
      >
        <Text color={sc.text.muted}>{STATUS_GLYPHS.info} {text}</Text>
      </Box>
    );
  },
);
