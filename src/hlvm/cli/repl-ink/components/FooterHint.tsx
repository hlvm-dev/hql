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
import {
  type StreamingState,
  StreamingState as ConversationStreamingState,
} from "../types.ts";
import { DEFAULT_TERMINAL_WIDTH } from "../ui-constants.ts";

import { truncate } from "../../../../common/utils.ts";

export const FOOTER_SECTION_SEPARATOR = " · ";

interface FooterProps {
  streamingState?: StreamingState;
  activeTool?: { name: string; toolIndex: number; toolTotal: number };
  modelName?: string;
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
    text = statusMessage || "";
    if (teamActive && teamAttentionCount && teamAttentionCount > 0) {
      text += `${text ? " · " : ""}Ctrl+T team (${teamAttentionCount})`;
    }
    return { text, tone };
  }

  // Warning states — keep visible since they require user action
  if (hasPendingPlanReview) {
    text = "Enter run · r revise · Esc cancel";
    tone = "warning";
  } else if (hasPendingPermission) {
    text = "Enter approve · Esc reject";
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
    text = "";
  }

  const queuedCount = Math.max(0, interactionQueueLength - 1);
  if (queuedCount > 0) {
    text += `${text ? " · " : ""}+${queuedCount} queued`;
  }

  if (teamActive) {
    text += teamAttentionCount && teamAttentionCount > 0
      ? `${text ? " · " : ""}Ctrl+T (${teamAttentionCount})`
      : "";
  }

  return { text, tone };
}

interface FooterRightStateInput {
  modelName?: string;
  contextUsageLabel?: string;
  checkpointLabel?: string;
}

export function buildFooterRightState({
  modelName,
  contextUsageLabel,
  checkpointLabel,
}: FooterRightStateInput): { infoText: string } {
  const infoParts: string[] = [];
  if (contextUsageLabel) infoParts.push(contextUsageLabel);
  if (checkpointLabel) infoParts.push(checkpointLabel);
  if (modelName) infoParts.push(modelName);
  return {
    infoText: infoParts.join(FOOTER_SECTION_SEPARATOR),
  };
}

export function FooterHint({
  streamingState,
  activeTool,
  modelName,
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
  const spinner = "·";

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
  const leftColor = left.tone === "warning" ? sc.status.warning : sc.text.muted;

  const right = buildFooterRightState({
    modelName: model,
    contextUsageLabel,
    checkpointLabel,
  });

  const rawTerminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  const contentWidth = Math.max(20, rawTerminalWidth - 2);

  // Single line: left status ... right model info
  const rightText = right.infoText;

  // Reserve space for right side, truncate left to fit
  const rightLen = rightText.length;
  const gap = 2; // minimum gap between left and right
  const leftMaxWidth = Math.max(8, contentWidth - rightLen - gap);
  const leftText = truncate(left.text, leftMaxWidth);

  return (
    <Box
      flexGrow={1}
      flexDirection="row"
      justifyContent="space-between"
      marginTop={1}
    >
      <Text color={leftColor}>{leftText}</Text>
      {rightText.length > 0 && <Text color={sc.text.muted}>{rightText}</Text>}
    </Box>
  );
}
