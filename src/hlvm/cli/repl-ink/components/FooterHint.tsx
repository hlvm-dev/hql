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
  terminalWidth?: number;
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
  contextUsageLabel?: string;
  checkpointLabel?: string;
  inConversation?: boolean;
}

function getFooterTextWidth(text?: string): number {
  return text ? Array.from(text).length : 0;
}

export function getFooterColumnWidths(
  terminalWidth?: number,
  leftText?: string,
  rightText?: string,
): { width: number; leftWidth: number; centerWidth: number; rightWidth: number } {
  const safeWidth = Math.max(terminalWidth ?? 80, 32);
  const maxSideWidth = Math.max(12, Math.floor(safeWidth * 0.28));
  const minCenterWidth = Math.min(safeWidth, Math.max(16, Math.floor(safeWidth * 0.4)));

  let leftWidth = leftText ? Math.min(maxSideWidth, getFooterTextWidth(leftText)) : 0;
  let rightWidth = rightText ? Math.min(maxSideWidth, getFooterTextWidth(rightText)) : 0;

  const getGapWidth = (width: number) => width > 0 ? 1 : 0;
  const computeCenterWidth = () =>
    safeWidth - leftWidth - rightWidth - getGapWidth(leftWidth) - getGapWidth(rightWidth);

  let centerWidth = computeCenterWidth();
  let deficit = minCenterWidth - centerWidth;

  const shrinkSide = (side: "left" | "right", minimumWidth: number) => {
    if (deficit <= 0) return;
    if (side === "left") {
      const available = Math.max(0, leftWidth - minimumWidth);
      const delta = Math.min(deficit, available);
      leftWidth -= delta;
      deficit -= delta;
      return;
    }

    const available = Math.max(0, rightWidth - minimumWidth);
    const delta = Math.min(deficit, available);
    rightWidth -= delta;
    deficit -= delta;
  };

  const widerSide = leftWidth >= rightWidth ? "left" : "right";
  const narrowerSide = widerSide === "left" ? "right" : "left";
  shrinkSide(widerSide, 8);
  shrinkSide(narrowerSide, 8);
  shrinkSide(widerSide, 0);
  shrinkSide(narrowerSide, 0);
  centerWidth = Math.max(0, computeCenterWidth());

  return {
    width: safeWidth,
    leftWidth,
    centerWidth,
    rightWidth,
  };
}

export function buildFooterRightState({
  modelName,
  contextUsageLabel,
  checkpointLabel,
  inConversation,
}: FooterRightStateInput): { infoText: string } {
  const infoParts: string[] = [];
  if (contextUsageLabel) infoParts.push(contextUsageLabel);
  if (checkpointLabel) infoParts.push(checkpointLabel);
  if (modelName && inConversation) infoParts.push(modelName);
  return {
    infoText: infoParts.join(" · "),
  };
}

export function FooterHint({
  terminalWidth,
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
    contextUsageLabel,
    checkpointLabel,
    inConversation,
  });
  const columns = getFooterColumnWidths(terminalWidth, modeLabel, right.infoText);

  return (
    <Box width={columns.width}>
      {columns.leftWidth > 0 && (
        <>
          <Box width={columns.leftWidth} flexShrink={0}>
            <Text color={sc.border.active} wrap="truncate-end">
              {modeLabel ?? ""}
            </Text>
          </Box>
          <Box width={1} flexShrink={0}>
            <Text> </Text>
          </Box>
        </>
      )}

      <Box width={columns.centerWidth} justifyContent="center" flexShrink={0}>
        <Text color={centerColor} wrap="truncate-end">
          {center.text}
        </Text>
      </Box>

      {columns.rightWidth > 0 && (
        <>
          <Box width={1} flexShrink={0}>
            <Text> </Text>
          </Box>
          <Box width={columns.rightWidth} justifyContent="flex-end" flexShrink={0}>
            <Text color={sc.text.muted} wrap="truncate-end">
              {right.infoText}
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
}
