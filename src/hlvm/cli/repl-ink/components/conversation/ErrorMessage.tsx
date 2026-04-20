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
  errorClass?: string;
  hint?: string | null;
}

export const ErrorMessage = React.memo(
  function ErrorMessage(
    { text, errorClass, hint }: ErrorMessageProps,
  ): React.ReactElement {
    const sc = useSemanticColors();
    const headerPrefix = errorClass ? `(${errorClass}) ` : "";
    return (
      <Box
        paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
        marginBottom={1}
        flexDirection="column"
      >
        <Text color={sc.status.error}>
          {STATUS_GLYPHS.error} {headerPrefix}{text}
        </Text>
        {hint
          ? <Text color={sc.text.muted}>Hint: {hint}</Text>
          : null}
      </Box>
    );
  },
);
