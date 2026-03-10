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
import { getConfirmationDialogDisplay } from "./interaction-dialog-layout.ts";

interface ConfirmationDialogProps {
  toolName?: string;
  toolArgs?: string;
}

export function ConfirmationDialog({ toolName, toolArgs }: ConfirmationDialogProps): React.ReactElement {
  const sc = useSemanticColors();
  const { isPlanReview, visibleArgLines, hiddenArgLines } =
    getConfirmationDialogDisplay(toolName, toolArgs);

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
          {isPlanReview ? "⚠ Plan Review Required" : "⚠ Permission Required"}
        </Text>
      </Box>
      {toolName && (
        <Box marginTop={0}>
          <Text color={sc.text.secondary}>
            {isPlanReview ? "Review: " : "Tool: "}
          </Text>
          <Text color={sc.text.primary} bold>
            {isPlanReview ? "execution plan" : toolName}
          </Text>
        </Box>
      )}
      {visibleArgLines.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          <Text color={sc.text.secondary}>{isPlanReview ? "Plan:" : "Args:"}</Text>
          <Box paddingLeft={1} flexDirection="column">
            {visibleArgLines.map((line: string, i: number) => (
              <React.Fragment key={i}>
                <Text color={sc.text.muted} wrap="truncate-end">{line}</Text>
              </React.Fragment>
            ))}
            {hiddenArgLines > 0 && (
              <Text color={sc.text.muted}>… {hiddenArgLines} more line{hiddenArgLines === 1 ? "" : "s"}</Text>
            )}
          </Box>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={sc.status.success} bold> y </Text>
        <Text color={sc.text.muted}>
          /Enter {isPlanReview ? "approve plan" : "approve"}  
        </Text>
        <Text color={sc.status.error} bold> n </Text>
        <Text color={sc.text.muted}>
          /Esc {isPlanReview ? "cancel run" : "reject"}
        </Text>
      </Box>
    </Box>
  );
}
