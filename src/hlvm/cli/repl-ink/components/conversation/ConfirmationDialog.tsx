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
import { ShortcutHint } from "../ShortcutHint.tsx";
import {
  splitArgKeyValue,
} from "./conversation-chrome.ts";
import { TRANSCRIPT_LAYOUT } from "../../utils/layout-tokens.ts";

interface ConfirmationDialogProps {
  requestId?: string;
  toolName?: string;
  toolArgs?: string;
  sourceLabel?: string;
  onResolve?: (requestId: string, response: InteractionResponse) => void;
}

export const ConfirmationDialog = React.memo(
  function ConfirmationDialog(
    {
      requestId,
      toolName,
      toolArgs,
      sourceLabel,
      onResolve,
    }: ConfirmationDialogProps,
  ): React.ReactElement {
    const sc = useSemanticColors();
    const dialog = getConfirmationDialogDisplay(toolName, toolArgs);
    const { isPlanReview, visibleArgLines, hiddenArgLines } = dialog;

    const buildPermissionOptions = (): InteractionPickerOption[] => {
      if (isPlanReview) {
        return [
          {
            label: "Yes, implement this plan",
            value: "approve:auto",
            detail:
              "Switch to Full auto and start coding without further permission prompts.",
            recommended: true,
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
        ];
      }
      return [
        {
          label: "Approve and continue",
          value: "approve",
          detail: "Allow this action and keep the current task moving.",
          recommended: true,
        },
        {
          label: "Reject",
          value: "reject",
          detail: "Decline the action. Add notes to steer the next attempt.",
        },
      ];
    };

    if (requestId && onResolve) {
      const options = buildPermissionOptions();
      const hintContent = (
        <Text color={sc.text.muted}>
          <ShortcutHint bindingId="tab" label="notes" />
          <Text color={sc.text.muted}> · Use arrows or 1-9 below · Enter submit · Esc cancel</Text>
        </Text>
      );
      const resolvePermission = (
        option: InteractionPickerOption,
        notes?: string,
      ): void => {
        const trimmedNotes = notes?.trim();
        if (option.value === "approve:auto") {
          onResolve(requestId, {
            approved: true,
            userInput: trimmedNotes
              ? `${option.value}\n\nNotes: ${trimmedNotes}`
              : option.value,
          });
          return;
        }
        if (option.value === "revise") {
          onResolve(requestId, {
            approved: false,
            userInput: trimmedNotes
              ? `revise\n\nNotes: ${trimmedNotes}`
              : "revise",
          });
          return;
        }
        if (option.value === "approve") {
          onResolve(requestId, {
            approved: true,
            userInput: trimmedNotes,
          });
          return;
        }
        onResolve(requestId, {
          approved: false,
          userInput: trimmedNotes,
        });
      };

      return (
        <InteractionPicker
          title={isPlanReview ? "Ready to start implementation?" : "Permission required"}
          subtitle={!isPlanReview
            ? "Review the requested action and decide what the agent should do next."
            : undefined}
          options={options}
          hint={PLAN_REVIEW_PICKER_HINT}
          hintContent={hintContent}
          tone="warning"
          allowNotes
          notesLabel={isPlanReview ? "Revision notes" : "Guidance"}
          notesPlaceholder={isPlanReview
            ? "Tell the agent what to revise..."
            : "Tell the agent what to do differently..."}
          notesEmptyText={isPlanReview
            ? "Press Tab to add revision notes."
            : "Press Tab to add guidance."}
          onSubmit={resolvePermission}
          onCancel={() => onResolve(requestId, { approved: false })}
        >
          <Box flexDirection="column">
            {sourceLabel && !isPlanReview && (
              <Box marginBottom={1}>
                <Text color={sc.text.secondary}>From: </Text>
                <Text color={sc.text.primary} bold>
                  {sourceLabel}
                </Text>
              </Box>
            )}
            <Text color={sc.text.secondary}>
              {isPlanReview ? "Overview" : "Request"}
            </Text>
            {toolName && !isPlanReview && (
              <Text color={sc.text.primary} bold>{toolName}</Text>
            )}
            <Text color={sc.text.primary} wrap="wrap">
              {dialog.planReview?.plan.goal ?? "Review the tool request below."}
            </Text>
            {dialog.planReview
              ? (
                <>
                  <Box marginTop={1} flexDirection="column">
                    <Text color={sc.text.secondary}>Implementation steps</Text>
                    {dialog.planReview.visibleSteps.map((step, index) => (
                      <React.Fragment key={step.id}>
                        <Text color={sc.text.primary} wrap="wrap">
                          {" "}
                          {index + 1}. {step.title}
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
                    <Box marginTop={1} flexDirection="column">
                      <Text color={sc.text.secondary}>Verification</Text>
                      {dialog.planReview.verificationLines.map((line) => (
                        <React.Fragment key={line}>
                          <Text color={sc.text.muted} wrap="wrap">
                            {" "}
                            • {line}
                          </Text>
                        </React.Fragment>
                      ))}
                    </Box>
                  )}
                </>
              )
              : visibleArgLines.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                  <Text color={sc.text.secondary}>Args</Text>
                  <Box
                    paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
                    flexDirection="column"
                  >
                    {visibleArgLines.map((line: string, i: number) => {
                      const kv = splitArgKeyValue(line);
                      if (kv) {
                        return (
                          <Box key={i}>
                            <Text color={sc.text.secondary} wrap="truncate-end">
                              {kv.key}
                              {kv.separator}
                            </Text>
                            <Text color={sc.text.muted} wrap="truncate-end">
                              {kv.value}
                            </Text>
                          </Box>
                        );
                      }
                      return (
                        <React.Fragment key={i}>
                          <Text color={sc.text.muted} wrap="truncate-end">
                            {line}
                          </Text>
                        </React.Fragment>
                      );
                    })}
                    {hiddenArgLines > 0 && (
                      <Text color={sc.text.muted}>
                        … {hiddenArgLines} more line{hiddenArgLines === 1 ? "" : "s"}
                      </Text>
                    )}
                  </Box>
                </Box>
              )}
          </Box>
        </InteractionPicker>
      );
    }

    return (
      <Box flexDirection="column">
        <Text color={isPlanReview ? sc.text.primary : sc.status.warning} bold>
          {isPlanReview ? "Ready to code?" : "Permission required"}
        </Text>
        {sourceLabel && (
          <Box marginTop={0}>
            <Text color={sc.text.secondary}>From:</Text>
            <Text color={sc.text.primary} bold>
              {sourceLabel}
            </Text>
          </Box>
        )}
        {isPlanReview && (
          <Text color={sc.text.secondary}>Review before proceeding.</Text>
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
            <Text color={sc.text.secondary}>Steps</Text>
            <Box
              paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
              flexDirection="column"
            >
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
                <Text color={sc.text.secondary}>Verification</Text>
                <Box
                  paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
                  flexDirection="column"
                >
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
            <Text color={sc.text.secondary}>{isPlanReview ? "Plan" : "Args"}</Text>
            <Box
              paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
              flexDirection="column"
            >
              {visibleArgLines.map((line: string, i: number) => {
                const kv = splitArgKeyValue(line);
                if (kv) {
                  return (
                    <Box key={i}>
                      <Text color={sc.text.secondary} wrap="truncate-end">
                        {kv.key}
                        {kv.separator}
                      </Text>
                      <Text color={sc.text.muted} wrap="truncate-end">
                        {kv.value}
                      </Text>
                    </Box>
                  );
                }
                return (
                  <React.Fragment key={i}>
                    <Text color={sc.text.muted} wrap="truncate-end">
                      {line}
                    </Text>
                  </React.Fragment>
                );
              })}
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
