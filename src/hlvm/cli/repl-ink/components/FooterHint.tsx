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
}: FooterCenterStateInput): { text: string; tone: "muted" | "warning" } {
  let text = "";
  let tone: "muted" | "warning" = "muted";

  if (!inConversation) {
    return { text: "? shortcuts", tone };
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

export function FooterHint({
  streamingState,
  activeTool,
  modelName,
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
  });
  const centerColor = center.tone === "warning"
    ? sc.status.warning
    : sc.text.muted;

  const rightParts: string[] = [];
  if (contextUsageLabel) rightParts.push(contextUsageLabel);
  if (checkpointLabel) rightParts.push(checkpointLabel);
  if (model) rightParts.push(model);

  return (
    <Box flexGrow={1} flexDirection="row" justifyContent="space-between">
      <Box flexGrow={1} justifyContent="center">
        <Text color={centerColor}>{center.text}</Text>
      </Box>

      <Box flexShrink={0} marginLeft={1}>
        <Text color={sc.text.muted}>
          {rightParts.join(" · ")}
        </Text>
      </Box>
    </Box>
  );
}
