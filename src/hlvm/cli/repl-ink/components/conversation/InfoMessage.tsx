/**
 * InfoMessage Component
 *
 * Displays an informational message with muted styling.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { STATUS_GLYPHS } from "../../ui-constants.ts";
import { ChromeChip } from "../ChromeChip.tsx";

interface InfoMessageProps {
  text: string;
}

export const InfoMessage = React.memo(
  function InfoMessage({ text }: InfoMessageProps): React.ReactElement {
    const sc = useSemanticColors();

    return (
      <Box
        marginBottom={1}
        borderStyle="round"
        borderLeft
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderColor={sc.border.dim}
        paddingLeft={1}
        flexDirection="column"
      >
        <Box>
          <ChromeChip text={`${STATUS_GLYPHS.info} Info`} tone="neutral" />
        </Box>
        <Text color={sc.text.muted} wrap="wrap">{text}</Text>
      </Box>
    );
  },
);
