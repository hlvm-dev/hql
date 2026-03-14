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

export const ConfirmationDialog = React.memo(
  function ConfirmationDialog(
    { toolName, toolArgs }: ConfirmationDialogProps,
  ): React.ReactElement {
    const sc = useSemanticColors();
    const dialog = getConfirmationDialogDisplay(toolName, toolArgs);
    const { isPlanReview, visibleArgLines, hiddenArgLines } = dialog;

    return (
      <Box
        borderStyle="round"
        borderColor={isPlanReview ? sc.border.active : sc.status.warning}
        paddingX={1}
        paddingY={0}
        flexDirection="column"
      >
        <Box>
          <Text
            color={isPlanReview ? sc.text.primary : sc.status.warning}
            bold
          >
            {isPlanReview ? "Ready to Code?" : "Permission Required"}
          </Text>
        </Box>
        {isPlanReview && (
          <Text color={sc.text.secondary}>
            Here is the proposed plan:
          </Text>
        )}
        {toolName && (
          <Box marginTop={0}>
            <Text color={sc.text.secondary}>
              {isPlanReview ? "Execution: " : "Tool: "}
            </Text>
            <Text color={sc.text.primary} bold>
              {isPlanReview ? "same session" : toolName}
            </Text>
          </Box>
        )}
        {dialog.planReview && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={sc.text.secondary}>Summary:</Text>
            <Box paddingLeft={1}>
              <Text color={sc.text.primary} wrap="wrap">
                {dialog.planReview.plan.goal}
              </Text>
            </Box>
            <Text color={sc.text.secondary}>Steps:</Text>
            <Box paddingLeft={1} flexDirection="column">
              {dialog.planReview.visibleSteps.map((step) => (
                <React.Fragment key={step.id}>
                  <Text color={sc.text.primary} wrap="truncate-end">
                    [ ] {step.title}
                  </Text>
                </React.Fragment>
              ))}
              {dialog.planReview.hiddenStepCount > 0 && (
                <Text color={sc.text.muted}>
                  … {dialog.planReview.hiddenStepCount} more step
                  {dialog.planReview.hiddenStepCount === 1 ? "" : "s"}
                </Text>
              )}
            </Box>
            {dialog.planReview.verificationLines.length > 0 && (
              <>
                <Text color={sc.text.secondary}>Verification:</Text>
                <Box paddingLeft={1} flexDirection="column">
                  {dialog.planReview.verificationLines.map((line) => (
                    <React.Fragment key={line}>
                      <Text color={sc.text.muted} wrap="truncate-end">
                        • {line}
                      </Text>
                    </React.Fragment>
                  ))}
                </Box>
              </>
            )}
          </Box>
        )}
        {!dialog.planReview && visibleArgLines.length > 0 && (
          <Box flexDirection="column" marginTop={0}>
            <Text color={sc.text.secondary}>
              {isPlanReview ? "Plan:" : "Args:"}
            </Text>
            <Box paddingLeft={1} flexDirection="column">
              {visibleArgLines.map((line: string, i: number) => (
                <React.Fragment key={i}>
                  <Text color={sc.text.muted} wrap="truncate-end">{line}</Text>
                </React.Fragment>
              ))}
              {hiddenArgLines > 0 && (
                <Text color={sc.text.muted}>
                  … {hiddenArgLines} more line{hiddenArgLines === 1 ? "" : "s"}
                </Text>
              )}
            </Box>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={sc.status.success} bold>y</Text>
          <Text color={sc.text.muted}>
            /Enter {isPlanReview ? "run" : "approve"}
          </Text>
          {isPlanReview && (
            <>
              <Text color={sc.status.warning} bold>r</Text>
              <Text color={sc.text.muted}>
                revise
              </Text>
            </>
          )}
          <Text color={sc.status.error} bold>n</Text>
          <Text color={sc.text.muted}>
            /Esc {isPlanReview ? "cancel run" : "reject"}
          </Text>
        </Box>
      </Box>
    );
  },
);
