import React from "react";
import { Box } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { ChromeChip, type ChromeChipTone } from "../ChromeChip.tsx";

interface ConversationCalloutProps {
  title: string;
  tone?: ChromeChipTone;
  marginBottom?: number;
  children?: React.ReactNode;
}

export function ConversationCallout({
  title,
  tone = "neutral",
  marginBottom = 1,
  children,
}: ConversationCalloutProps): React.ReactElement {
  const sc = useSemanticColors();
  const borderColor = tone === "warning"
    ? sc.status.warning
    : tone === "success"
    ? sc.status.success
    : tone === "error"
    ? sc.status.error
    : tone === "active"
    ? sc.border.active
    : sc.border.dim;

  return (
    <Box
      marginBottom={marginBottom}
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      paddingY={0}
      flexDirection="column"
    >
      <Box>
        <ChromeChip text={title} tone={tone} />
      </Box>
      {children}
    </Box>
  );
}
