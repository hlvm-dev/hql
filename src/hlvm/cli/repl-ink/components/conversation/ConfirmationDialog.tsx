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
import {
  getConfirmationDialogDisplay,
  PLAN_REVIEW_PICKER_HINT,
} from "./interaction-dialog-layout.ts";
import {
  InteractionPicker,
  type InteractionPickerOption,
} from "./InteractionPicker.tsx";
import type { InteractionResponse } from "../../../../agent/registry.ts";

interface ConfirmationDialogProps {
  requestId?: string;
  toolName?: string;
  toolArgs?: string;
  onResolve?: (requestId: string, response: InteractionResponse) => void;
}

export const ConfirmationDialog = React.memo(
  function ConfirmationDialog(
    { requestId, toolName, toolArgs, onResolve }: ConfirmationDialogProps,
  ): React.ReactElement {
    const sc = useSemanticColors();
    const dialog = getConfirmationDialogDisplay(toolName, toolArgs);
    const { isPlanReview, visibleArgLines, hiddenArgLines } = dialog;

    if (isPlanReview && dialog.planReview && requestId && onResolve) {
      return (
        <InteractionPicker
          title="Implement this plan?"
          options={[
            {
              label: "Yes, implement this plan",
              value: "approve:auto",
              detail:
                "Switch to Full auto and start coding without further permission prompts.",
              recommended: true,
            },
            {
              label: "Yes, manually approve actions",
              value: "approve:manual",
              detail: "Switch to Default and confirm risky actions as they happen.",
            },
            {
              label: "Revise this plan",
              value: "revise",
              detail: "Stay in Plan mode and continue planning with the model.",
            },
            {
              label: "Cancel",
              value: "cancel",
              detail: "Stop here without implementing or continuing planning.",
            },
          ]}
          hint={PLAN_REVIEW_PICKER_HINT}
          onSubmit={(option: InteractionPickerOption) => {
            if (
              option.value === "approve:auto" ||
              option.value === "approve:manual"
            ) {
              onResolve(requestId, {
                approved: true,
                userInput: option.value,
              });
              return;
            }
            if (option.value === "revise") {
              onResolve(requestId, {
                approved: false,
                userInput: "revise",
              });
              return;
            }
            onResolve(requestId, { approved: false });
          }}
          onCancel={() => onResolve(requestId, { approved: false })}
        >
          <Box flexDirection="column">
            <Text color={sc.text.secondary}>
              Here is the plan:
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text color={sc.text.primary} wrap="wrap">
                {dialog.planReview.plan.goal}
              </Text>
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
                    ... {dialog.planReview.hiddenStepCount} more step
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
          </Box>
        </InteractionPicker>
      );
    }

    return (
      <Box
        borderStyle={isPlanReview ? undefined : "round"}
        borderColor={isPlanReview ? undefined : sc.status.warning}
        paddingX={isPlanReview ? 0 : 1}
        paddingY={0}
        flexDirection="column"
      >
        <Box>
          <Text
            color={isPlanReview ? sc.text.primary : sc.status.warning}
            bold
          >
            {isPlanReview ? "Ready to code?" : "Permission required"}
          </Text>
        </Box>
        {isPlanReview && (
          <Text color={sc.text.secondary}>
            Here is the plan:
          </Text>
        )}
        {toolName && !isPlanReview && (
          <Box marginTop={0}>
            <Text color={sc.text.secondary}>Tool:</Text>
            <Text color={sc.text.primary} bold>
              {toolName}
            </Text>
          </Box>
        )}
        {dialog.planReview && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={sc.text.primary} wrap="wrap">
              {dialog.planReview.plan.goal}
            </Text>
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
          <Text color={sc.status.success} bold>Enter</Text>
          <Text color={sc.text.muted}>
            {" "}
            {isPlanReview ? "run" : "approve"}
          </Text>
          {isPlanReview && (
            <>
              <Text color={sc.text.muted}>·</Text>
              <Text color={sc.status.warning} bold>r</Text>
              <Text color={sc.text.muted}>
                {" "}revise
              </Text>
            </>
          )}
          <Text color={sc.text.muted}>·</Text>
          <Text color={sc.status.error} bold>Esc</Text>
          <Text color={sc.text.muted}>
            {" "}
            {isPlanReview ? "cancel" : "reject"}
          </Text>
        </Box>
      </Box>
    );
  },
);
