/**
 * Footer Component
 *
 * Minimal footer:
 * - Center: streaming state / interaction hints
 * - Right: model + context usage
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../theme/index.ts";
import type { StreamingState } from "../types.ts";
import { StreamingState as ConversationStreamingState } from "../types.ts";
import { BRAILLE_SPINNER_FRAMES } from "../ui-constants.ts";
import { useSpinnerFrame } from "../hooks/useSpinnerFrame.ts";

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
  /** Number of queued user chat turns */
  queuedUserTurnCount?: number;
  /** Whether conversation panel is active */
  inConversation?: boolean;
  /** Whether a permission dialog is pending */
  hasPendingPermission?: boolean;
  /** Whether a question dialog is pending */
  hasPendingQuestion?: boolean;
}

interface FooterCenterStateInput {
  inConversation?: boolean;
  streamingState?: StreamingState;
  activeTool?: { name: string; toolIndex: number; toolTotal: number };
  interactionQueueLength?: number;
  queuedUserTurnCount?: number;
  hasPendingPermission?: boolean;
  hasPendingQuestion?: boolean;
  spinner: string;
  statusMessage?: string;
}

export function buildFooterCenterState({
  inConversation,
  streamingState,
  activeTool,
  interactionQueueLength = 0,
  queuedUserTurnCount = 0,
  hasPendingPermission,
  hasPendingQuestion,
  spinner,
  statusMessage,
}: FooterCenterStateInput): { text: string; tone: "muted" | "warning" } {
  let text = "";
  let tone: "muted" | "warning" = "muted";

  if (!inConversation) {
    return { text: statusMessage || "? shortcuts", tone };
  }

  if (hasPendingPermission) {
    text = "⚠ Awaiting approval: y/Enter approve · n/Esc reject";
    tone = "warning";
  } else if (hasPendingQuestion) {
    text = "? Awaiting answer: use answer> prompt + Enter · Esc reject";
    tone = "warning";
  } else if (
    streamingState === ConversationStreamingState.WaitingForConfirmation
  ) {
    text = "⚠ Waiting for confirmation";
    tone = "warning";
  } else if (streamingState === ConversationStreamingState.Responding) {
    if (activeTool) {
      text =
        `${spinner} Running ${activeTool.name} (${activeTool.toolIndex}/${activeTool.toolTotal}) · Esc cancel`;
      tone = "warning";
    } else {
      // The conversation body already renders a Thinking block; keep the footer action-focused.
      text = "Esc cancel · PgUp/PgDn scroll";
    }
  } else if (statusMessage) {
    text = statusMessage;
  } else {
    text = "Ready · PgUp/PgDn scroll · ? shortcuts";
  }

  if (interactionQueueLength > 1) {
    text += ` · +${interactionQueueLength - 1} queued`;
  }
  if (queuedUserTurnCount > 0) {
    text += ` · +${queuedUserTurnCount} queued message${
      queuedUserTurnCount === 1 ? "" : "s"
    }`;
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
    infoText: infoParts.join(" · "),
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
  queuedUserTurnCount = 0,
  inConversation,
  hasPendingPermission,
  hasPendingQuestion,
}: FooterProps): React.ReactElement {
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
    queuedUserTurnCount,
    hasPendingPermission,
    hasPendingQuestion,
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

  return (
    <Box flexGrow={1} flexDirection="row" justifyContent="space-between">
      <Box flexGrow={1} justifyContent="center">
        <Text color={centerColor}>{center.text}</Text>
      </Box>

      <Box flexShrink={0} marginLeft={1}>
        {right.modeLabel && (
          <Text color={sc.border.active}>
            {right.modeLabel}
          </Text>
        )}
        {right.modeLabel && right.infoText && (
          <Text color={sc.text.muted}>{" · "}</Text>
        )}
        <Text color={sc.text.muted}>
          {right.infoText}
        </Text>
      </Box>
    </Box>
  );
}
