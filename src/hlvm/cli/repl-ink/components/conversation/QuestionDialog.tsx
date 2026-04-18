import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import {
  getQuestionDialogDisplay,
  QUESTION_DIALOG_HINT,
  QUESTION_PICKER_HINT,
} from "./interaction-dialog-layout.ts";
import {
  InteractionPicker,
  type InteractionPickerOption,
} from "./InteractionPicker.tsx";
import type {
  InteractionOption,
  InteractionResponse,
} from "../../../../agent/registry.ts";
import { PermissionDialogFrame } from "./PermissionDialogFrame.tsx";

interface QuestionDialogProps {
  requestId?: string;
  question?: string;
  options?: InteractionOption[];
  sourceLabel?: string;
  onResolve?: (requestId: string, response: InteractionResponse) => void;
  onInterrupt?: () => void;
}

export const QuestionDialog = React.memo(function QuestionDialog(
  {
    requestId,
    question,
    options,
    sourceLabel,
    onResolve,
    onInterrupt,
  }: QuestionDialogProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const dialog = getQuestionDialogDisplay(question, options);
  const promptTitle = "Reply needed";
  const promptSubtitle = sourceLabel?.trim() || undefined;

  const buildQuestionResponse = (
    option: InteractionPickerOption,
    notes: string | undefined,
  ): string => {
    const trimmedNotes = notes?.trim() ?? "";
    const isCustomChoice = /\b(other|something else|describe)\b/i.test(
      `${option.label} ${option.value}`,
    );
    if (trimmedNotes.length === 0) {
      return option.value;
    }
    if (isCustomChoice) {
      return trimmedNotes;
    }
    return `${option.value}\n\nNotes: ${trimmedNotes}`;
  };

  if (dialog.usesPicker && requestId && onResolve) {
    return (
      <PermissionDialogFrame title={promptTitle} subtitle={promptSubtitle}>
        <InteractionPicker
          title=""
          options={dialog.options}
          hint=""
          hintContent={(
            <Text color={sc.text.muted}>{QUESTION_PICKER_HINT}</Text>
          )}
          tone="active"
          allowNotes
          notesLabel="Response"
          notesPlaceholder="Type your response..."
          notesEmptyText="Press Tab to amend your reply."
          onSubmit={(option: InteractionPickerOption, notes?: string) =>
            onResolve(requestId, {
              approved: true,
              userInput: buildQuestionResponse(option, notes),
            })}
          onCancel={() =>
            onInterrupt
              ? onInterrupt()
              : onResolve(requestId, { approved: false })}
        >
          {dialog.question && (
            <Text color={sc.text.primary} wrap="wrap">
              {dialog.question}
            </Text>
          )}
        </InteractionPicker>
      </PermissionDialogFrame>
    );
  }

  return (
    <PermissionDialogFrame title={promptTitle} subtitle={promptSubtitle}>
      <Box flexDirection="column">
        {dialog.question && (
          <Text color={sc.text.primary} wrap="wrap">
            {dialog.question}
          </Text>
        )}
        <Box marginTop={1}>
          <Text color={sc.text.muted}>{QUESTION_DIALOG_HINT}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={sc.text.muted}>Esc to cancel</Text>
        </Box>
      </Box>
    </PermissionDialogFrame>
  );
});
