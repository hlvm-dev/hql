import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";

interface PermissionDialogFrameProps {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export function PermissionDialogFrame(
  { title, subtitle, children }: PermissionDialogFrameProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const hasHeader = (title?.trim().length ?? 0) > 0 ||
    (subtitle?.trim().length ?? 0) > 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={sc.surface.modal.borderActive}
      borderLeft={false}
      borderRight={false}
      borderBottom={false}
      marginTop={1}
    >
      {hasHeader && (
        <Box paddingX={1} flexDirection="column">
          {title && <Text color={sc.surface.modal.title} bold>{title}</Text>}
          {subtitle && (
            <Text color={sc.text.muted} wrap="truncate-start">
              {subtitle}
            </Text>
          )}
        </Box>
      )}
      <Box flexDirection="column" paddingX={1}>
        {children}
      </Box>
    </Box>
  );
}
