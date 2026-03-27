import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import {
  buildTranscriptDivider,
  TRANSCRIPT_LAYOUT,
} from "../../utils/layout-tokens.ts";

interface TranscriptDividerProps {
  width: number;
}

export const TranscriptDivider = React.memo(function TranscriptDivider(
  { width }: TranscriptDividerProps,
): React.ReactElement {
  const sc = useSemanticColors();
  return (
    <Box
      marginTop={TRANSCRIPT_LAYOUT.dividerMarginTop}
      marginBottom={TRANSCRIPT_LAYOUT.dividerMarginBottom}
    >
      <Text color={sc.chrome.separator}>{buildTranscriptDivider(width)}</Text>
    </Box>
  );
});
