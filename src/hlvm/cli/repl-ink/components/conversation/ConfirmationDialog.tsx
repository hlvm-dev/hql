/**
 * ConfirmationDialog Component
 *
 * Displays a tool permission confirmation dialog.
 * Keyboard: y/Enter = approve, n/Esc = reject.
 * Visual: prominent bordered box with clear action hints.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";

interface ConfirmationDialogProps {
  toolName?: string;
  toolArgs?: string;
}

export function ConfirmationDialog({ toolName, toolArgs }: ConfirmationDialogProps): React.ReactElement {
  const sc = useSemanticColors();

  return (
    <Box
      borderStyle="round"
      borderColor={sc.status.warning}
      paddingX={1}
      paddingY={0}
      flexDirection="column"
    >
      <Box>
        <Text color={sc.status.warning} bold>
          {"⚠ Permission required"}
        </Text>
      </Box>
      {toolName && (
        <Box marginTop={0}>
          <Text color={sc.text.secondary}>Tool: </Text>
          <Text color={sc.text.primary} bold>{toolName}</Text>
        </Box>
      )}
      {toolArgs && (
        <Box>
          <Text color={sc.text.secondary}>Args: </Text>
          <Text color={sc.text.muted} wrap="truncate-end">
            {toolArgs}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={sc.status.success} bold> y </Text>
        <Text color={sc.text.muted}>/Enter approve  </Text>
        <Text color={sc.status.error} bold> n </Text>
        <Text color={sc.text.muted}>/Esc reject</Text>
      </Box>
    </Box>
  );
}
