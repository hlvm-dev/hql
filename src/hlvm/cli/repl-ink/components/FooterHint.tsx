/**
 * Footer Component
 *
 * Single-line Codex-style footer:
 * - Left: context-aware status / action hints
 * - Right: model name + optional context usage
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { useSemanticColors } from "../../theme/index.ts";
import { type StreamingState, StreamingState as ConversationStreamingState } from "../types.ts";
import { BRAILLE_SPINNER_FRAMES, DEFAULT_TERMINAL_WIDTH } from "../ui-constants.ts";
import { useSpinnerFrame } from "../hooks/useSpinnerFrame.ts";
import { truncate } from "../../../../common/utils.ts";

export const FOOTER_SECTION_SEPARATOR = " · ";

interface FooterProps {
  streamingState?: StreamingState;
  activeTool?: { name: string; toolIndex: number; toolTotal: number };
  modelName?: string;
  modeLabel?: string;
  statusMessage?: string;
  contextUsageLabel?: string;
  checkpointLabel?: string;
  interactionQueueLength?: number;
  hasDraftInput?: boolean;
  inConversation?: boolean;
  hasPendingPermission?: boolean;
  hasPendingPlanReview?: boolean;
  hasPendingQuestion?: boolean;
  teamActive?: boolean;
  teamAttentionCount?: number;
}

interface FooterLeftStateInput {
  inConversation?: boolean;
  streamingState?: StreamingState;
  activeTool?: { name: string; toolIndex: number; toolTotal: number };
  interactionQueueLength?: number;
  hasDraftInput?: boolean;
  hasPendingPermission?: boolean;
  hasPendingPlanReview?: boolean;
  hasPendingQuestion?: boolean;
  teamActive?: boolean;
  teamAttentionCount?: number;
  spinner: string;
  statusMessage?: string;
}

export function buildFooterLeftState({
  inConversation,
  streamingState,
  activeTool,
  interactionQueueLength = 0,
  hasDraftInput,
  hasPendingPermission,
  hasPendingPlanReview,
  hasPendingQuestion,
  teamActive,
  teamAttentionCount,
  spinner,
  statusMessage,
}: FooterLeftStateInput): { text: string; tone: "muted" | "warning" } {
  let text = "";
  let tone: "muted" | "warning" = "muted";

  if (!inConversation) {
    text = statusMessage || "Ready";
    if (teamActive) {
      text += teamAttentionCount && teamAttentionCount > 0
        ? ` · Ctrl+T team (${teamAttentionCount})`
        : "";
    }
    return { text, tone };
  }

  // Warning states — keep visible since they require user action
  if (hasPendingPlanReview) {
    text = "y run · r revise · n cancel";
    tone = "warning";
  } else if (hasPendingPermission) {
    text = "y approve · n reject";
    tone = "warning";
  } else if (hasPendingQuestion) {
    text = "answer> then Enter · Esc reject";
    tone = "warning";
  } else if (
    streamingState === ConversationStreamingState.WaitingForConfirmation
  ) {
    text = "Waiting for confirmation";
    tone = "warning";
  } else if (streamingState === ConversationStreamingState.Responding) {
    if (hasDraftInput) {
      // Has text while responding — show queue/force hints
      text = "tab queue · ctrl+enter force";
    } else if (activeTool) {
      text =
        `${spinner} ${activeTool.name} (${activeTool.toolIndex}/${activeTool.toolTotal}) · esc cancel`;
      tone = "warning";
    } else {
      text = "esc cancel";
    }
  } else if (statusMessage) {
    text = statusMessage;
  } else {
    text = "Ready";
  }

  const queuedCount = Math.max(0, interactionQueueLength - 1);
  if (queuedCount > 0) {
    text += ` · +${queuedCount} queued`;
  }

  if (teamActive) {
    text += teamAttentionCount && teamAttentionCount > 0
      ? ` · Ctrl+T (${teamAttentionCount})`
      : "";
  }

  return { text, tone };
}

interface FooterRightStateInput {
  modelName?: string;
  modeLabel?: string;
  contextUsageLabel?: string;
  checkpointLabel?: string;
}

export function buildFooterRightState({
  modelName,
  modeLabel,
  contextUsageLabel,
  checkpointLabel,
}: FooterRightStateInput): { modeLabel?: string; infoText: string } {
  const infoParts: string[] = [];
  if (contextUsageLabel) infoParts.push(contextUsageLabel);
  if (checkpointLabel) infoParts.push(checkpointLabel);
  if (modelName) infoParts.push(modelName);
  return {
    modeLabel,
    infoText: infoParts.join(FOOTER_SECTION_SEPARATOR),
  };
}

export function FooterHint({
  streamingState,
  activeTool,
  modelName,
  modeLabel,
  statusMessage,
  contextUsageLabel,
  checkpointLabel,
  interactionQueueLength = 0,
  hasDraftInput,
  inConversation,
  hasPendingPermission,
  hasPendingPlanReview,
  hasPendingQuestion,
  teamActive,
  teamAttentionCount,
}: FooterProps): React.ReactElement {
  const { stdout } = useStdout();
  const sc = useSemanticColors();
  const model = modelName ?? "";
  const isResponding = inConversation &&
    streamingState === ConversationStreamingState.Responding;
  const spinnerFrame = useSpinnerFrame(isResponding);
  const spinner = BRAILLE_SPINNER_FRAMES[spinnerFrame];

  const left = buildFooterLeftState({
    inConversation,
    streamingState,
    activeTool,
    interactionQueueLength,
    hasDraftInput,
    hasPendingPermission,
    hasPendingPlanReview,
    hasPendingQuestion,
    teamActive,
    teamAttentionCount,
    spinner,
    statusMessage,
  });
  const leftColor = left.tone === "warning"
    ? sc.status.warning
    : sc.text.muted;

  const right = buildFooterRightState({
    modelName: model,
    modeLabel,
    contextUsageLabel,
    checkpointLabel,
  });

  const rawTerminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  const contentWidth = Math.max(20, rawTerminalWidth - 2);

  // Single line: left status ... right model info
  const rightParts: string[] = [];
  if (right.modeLabel) rightParts.push(right.modeLabel);
  if (right.infoText) rightParts.push(right.infoText);
  const rightText = rightParts.join(FOOTER_SECTION_SEPARATOR);

  // Reserve space for right side, truncate left to fit
  const rightLen = rightText.length;
  const gap = 2; // minimum gap between left and right
  const leftMaxWidth = Math.max(8, contentWidth - rightLen - gap);
  const leftText = truncate(left.text, leftMaxWidth);

  return (
    <Box flexGrow={1} flexDirection="row" justifyContent="space-between" marginTop={1}>
      <Text color={leftColor}>{leftText}</Text>
      {rightText.length > 0 && (
        <Text color={sc.text.muted}>{rightText}</Text>
      )}
    </Box>
  );
}
