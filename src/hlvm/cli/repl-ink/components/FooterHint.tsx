/**
 * Footer Component
 *
 * Minimal footer:
 * - Center: streaming state / interaction hints
 * - Right: model + context usage
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { useSemanticColors } from "../../theme/index.ts";
import type { StreamingState } from "../types.ts";
import { StreamingState as ConversationStreamingState } from "../types.ts";
import { BRAILLE_SPINNER_FRAMES } from "../ui-constants.ts";
import { useSpinnerFrame } from "../hooks/useSpinnerFrame.ts";
import { truncate } from "../../../../common/utils.ts";
import { DEFAULT_TERMINAL_WIDTH } from "../ui-constants.ts";

export const FOOTER_SECTION_SEPARATOR = " · ";
const COMPACT_FOOTER_WIDTH = 76;

interface FooterProps {
  streamingState?: StreamingState;
  activeTool?: { name: string; toolIndex: number; toolTotal: number };
  modelName?: string;
  modeLabel?: string;
  statusMessage?: string;
  /** Compact context/tokens indicator (e.g., "35% ctx", "4200 tokens") */
  contextUsageLabel?: string;
  /** Compact safety/checkpoint indicator (e.g., "undo ready") */
  checkpointLabel?: string;
  /** Number of queued interactions */
  interactionQueueLength?: number;
  /** Whether the composer currently has draft content */
  hasDraftInput?: boolean;
  /** Whether conversation panel is active */
  inConversation?: boolean;
  /** Whether a permission dialog is pending */
  hasPendingPermission?: boolean;
  /** Whether a question dialog is pending */
  hasPendingQuestion?: boolean;
  /** Whether a team session is active even if there is no attention item yet */
  teamActive?: boolean;
  teamAttentionCount?: number;
}

interface FooterCenterStateInput {
  inConversation?: boolean;
  streamingState?: StreamingState;
  activeTool?: { name: string; toolIndex: number; toolTotal: number };
  interactionQueueLength?: number;
  hasDraftInput?: boolean;
  hasPendingPermission?: boolean;
  hasPendingQuestion?: boolean;
  teamActive?: boolean;
  teamAttentionCount?: number;
  spinner: string;
  statusMessage?: string;
}

export function buildFooterCenterState({
  inConversation,
  streamingState,
  activeTool,
  interactionQueueLength = 0,
  hasDraftInput,
  hasPendingPermission,
  hasPendingQuestion,
  teamActive,
  teamAttentionCount,
  spinner,
  statusMessage,
}: FooterCenterStateInput): { text: string; tone: "muted" | "warning" } {
  let text = "";
  let tone: "muted" | "warning" = "muted";

  if (!inConversation) {
    const baseText = statusMessage || "/help shortcuts";
    const teamHint = teamActive
      ? teamAttentionCount && teamAttentionCount > 0
        ? ` \u00B7 Ctrl+T team (${teamAttentionCount})`
        : " \u00B7 Ctrl+T team"
      : "";
    return { text: `${baseText}${teamHint}`, tone };
  }

  if (hasPendingPermission) {
    text = "\u26A0 Awaiting approval: y/Enter approve \u00B7 n/Esc reject";
    tone = "warning";
  } else if (hasPendingQuestion) {
    text = "? Awaiting answer: use answer> prompt + Enter \u00B7 Esc reject";
    tone = "warning";
  } else if (
    streamingState === ConversationStreamingState.Responding &&
    hasDraftInput
  ) {
    text = "Tab to queue message";
  } else if (
    streamingState === ConversationStreamingState.WaitingForConfirmation
  ) {
    text = "\u26A0 Waiting for confirmation";
    tone = "warning";
  } else if (streamingState === ConversationStreamingState.Responding) {
    if (activeTool) {
      text =
        `${spinner} Running ${activeTool.name} (${activeTool.toolIndex}/${activeTool.toolTotal}) \u00B7 Esc cancel`;
      tone = "warning";
    } else {
      text = "Esc cancel \u00B7 Ctrl+Enter force";
    }
  } else if (statusMessage) {
    text = statusMessage;
  } else {
    text = "Ready \u00B7 PgUp/PgDn scroll \u00B7 /help shortcuts";
  }

  const queuedCount = Math.max(0, interactionQueueLength - 1);
  if (queuedCount > 0) {
    text += ` \u00B7 +${queuedCount} queued`;
  }

  if (teamActive) {
    text += teamAttentionCount && teamAttentionCount > 0
      ? ` \u00B7 Ctrl+T team (${teamAttentionCount})`
      : " \u00B7 Ctrl+T team";
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

export function shouldUseCompactFooter(width: number): boolean {
  return width < COMPACT_FOOTER_WIDTH;
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
  const center = buildFooterCenterState({
    inConversation,
    streamingState,
    activeTool,
    interactionQueueLength,
    hasDraftInput,
    hasPendingPermission,
    hasPendingQuestion,
    teamActive,
    teamAttentionCount,
    spinner,
    statusMessage,
  });
  const centerColor = center.tone === "warning"
    ? sc.status.warning
    : sc.text.muted;
  const right = buildFooterRightState({
    modelName: model,
    modeLabel,
    contextUsageLabel,
    checkpointLabel,
  });
  const rawTerminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  // Account for parent paddingX={1} (1 char each side = 2 chars total)
  const contentWidth = Math.max(20, rawTerminalWidth - 2);
  const compactFooter = shouldUseCompactFooter(contentWidth);

  // Right section: mode badge + info (model, context, checkpoint)
  const rightRawLength = (right.modeLabel ? right.modeLabel.length + 3 : 0) +
    right.infoText.length;
  const rightMaxWidth = compactFooter
    ? 0
    : Math.min(rightRawLength, Math.max(14, Math.floor(contentWidth * 0.45)));
  const rightModeWidth = right.modeLabel
    ? Math.min(right.modeLabel.length, rightMaxWidth)
    : 0;
  const rightInfoWidth = Math.max(
    0,
    rightMaxWidth - rightModeWidth -
      (right.modeLabel && right.infoText ? 3 : 0),
  );
  const truncatedModeLabel = right.modeLabel && rightModeWidth > 0
    ? truncate(right.modeLabel, rightModeWidth)
    : "";
  const truncatedInfoText = rightInfoWidth > 0
    ? truncate(right.infoText, rightInfoWidth)
    : "";

  // Left section gets the remaining space
  const leftWidth = compactFooter
    ? contentWidth
    : Math.max(12, contentWidth - rightMaxWidth);
  const centerText = truncate(center.text, leftWidth);

  return (
    <Box flexGrow={1} flexDirection="row" justifyContent="space-between">
      <Box>
        <Text color={centerColor}>{centerText}</Text>
      </Box>

      {!compactFooter && (
        <Box justifyContent="flex-end" flexShrink={0}>
          {truncatedModeLabel && (
            <Text color={sc.border.active}>
              {truncatedModeLabel}
            </Text>
          )}
          {truncatedModeLabel && truncatedInfoText && (
            <Text color={sc.text.muted}>{FOOTER_SECTION_SEPARATOR}</Text>
          )}
          <Text color={sc.text.muted}>
            {truncatedInfoText}
          </Text>
        </Box>
      )}
    </Box>
  );
}
