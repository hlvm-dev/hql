/**
 * ErrorMessage Component
 *
 * Displays an error message with icon prefix, flat text (no box).
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { STATUS_GLYPHS } from "../../ui-constants.ts";
import { TRANSCRIPT_LAYOUT } from "../../utils/layout-tokens.ts";

interface ErrorMessageProps {
  text: string;
}

export const ErrorMessage = React.memo(
  function ErrorMessage({ text }: ErrorMessageProps): React.ReactElement {
    const sc = useSemanticColors();
    return (
      <Box
        paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
        marginBottom={1}
      >
        <Text color={sc.status.error}>{STATUS_GLYPHS.error} {text}</Text>
      </Box>
    );
  },
);
