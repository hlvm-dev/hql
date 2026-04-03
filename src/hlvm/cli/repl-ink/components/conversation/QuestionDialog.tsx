/**
 * QuestionDialog Component
 *
 * Displays an agent question dialog for user text input.
 * Submit on Enter.
 */

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
import { ShortcutHint } from "../ShortcutHint.tsx";
import type {
  InteractionOption,
  InteractionResponse,
} from "../../../../agent/registry.ts";

interface QuestionDialogProps {
  requestId?: string;
  question?: string;
  options?: InteractionOption[];
  onResolve?: (requestId: string, response: InteractionResponse) => void;
  onInterrupt?: () => void;
}

export const QuestionDialog = React.memo(function QuestionDialog(
  { requestId, question, options, onResolve, onInterrupt }: QuestionDialogProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const dialog = getQuestionDialogDisplay(question, options);

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
      <InteractionPicker
        title="Clarification needed"
        subtitle={dialog.question}
        options={dialog.options}
        hint={QUESTION_PICKER_HINT}
        hintContent={(
          <Text color={sc.text.muted}>
            <ShortcutHint bindingId="tab" label="notes" />
            <Text color={sc.text.muted}> · Use arrows or 1-9 below · Enter submit · Esc cancel</Text>
          </Text>
        )}
        tone="warning"
        allowNotes
        notesLabel="Reply details"
        notesPlaceholder="Type the clarification here..."
        notesEmptyText="Press Tab to add more context."
        onSubmit={(option: InteractionPickerOption, notes?: string) =>
          onResolve(requestId, {
            approved: true,
            userInput: buildQuestionResponse(option, notes),
          })}
        onCancel={() =>
          onInterrupt
            ? onInterrupt()
            : onResolve(requestId, { approved: false })}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text color={sc.status.warning} bold>Clarification needed</Text>
      {dialog.question && (
        <Box marginTop={0}>
          <Text color={sc.text.primary} wrap="wrap">
            {dialog.question}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={sc.text.muted}>{QUESTION_DIALOG_HINT}</Text>
      </Box>
      <Box>
        <Text color={sc.text.muted}>
          <ShortcutHint bindingId="enter-history" label="submit" />
          <Text color={sc.text.muted}> · </Text>
          <ShortcutHint bindingId="escape-history" label="cancel" />
        </Text>
      </Box>
    </Box>
  );
});
