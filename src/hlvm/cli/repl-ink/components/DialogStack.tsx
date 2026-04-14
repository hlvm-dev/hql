import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../theme/index.ts";
import type {
  InteractionRequestEvent,
  InteractionResponse,
} from "../../../agent/registry.ts";
import {
  ConfirmationDialog,
  QuestionDialog,
} from "./conversation/index.ts";

interface DialogStackProps {
  interactionRequest?: InteractionRequestEvent;
  interactionQueueLength?: number;
  onInteractionResponse?: (
    requestId: string,
    response: InteractionResponse,
  ) => void;
  onQuestionInterrupt?: () => void;
}

export function DialogStack(
  {
    interactionRequest,
    interactionQueueLength = 0,
    onInteractionResponse,
    onQuestionInterrupt,
  }: DialogStackProps,
): React.ReactElement | null {
  const sc = useSemanticColors();

  if (!interactionRequest || !onInteractionResponse) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {interactionQueueLength > 1 && (
        <Text color={sc.status.warning}>
          {interactionQueueLength - 1} more interaction
          {interactionQueueLength - 1 === 1 ? "" : "s"} queued
        </Text>
      )}
      {interactionRequest.mode === "permission" && (
        <ConfirmationDialog
          requestId={interactionRequest.requestId}
          toolName={interactionRequest.toolName}
          toolArgs={interactionRequest.toolArgs}
          sourceLabel={interactionRequest.sourceLabel}
          onResolve={onInteractionResponse}
        />
      )}
      {interactionRequest.mode === "question" && (
        <QuestionDialog
          requestId={interactionRequest.requestId}
          question={interactionRequest.question}
          options={interactionRequest.options}
          onResolve={onInteractionResponse}
          onInterrupt={onQuestionInterrupt}
        />
      )}
    </Box>
  );
}
