/**
 * Footer Component
 *
 * Minimal footer:
 * - Center: streaming state / interaction hints
 * - Right: model + context usage
 */

import React from "react";
import { Text, Box } from "ink";
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

export function FooterHint({
  streamingState,
  activeTool,
  modelName,
  contextUsageLabel,
  interactionQueueLength = 0,
  queuedUserTurnCount = 0,
  inConversation,
  hasPendingPermission,
  hasPendingQuestion,
}: FooterProps): React.ReactElement {
  const sc = useSemanticColors();
  const model = modelName ?? "";
  const isResponding = inConversation && streamingState === ConversationStreamingState.Responding;
  const spinnerFrame = useSpinnerFrame(isResponding);
  const spinner = BRAILLE_SPINNER_FRAMES[spinnerFrame];

  let centerText = "";
  let centerColor = sc.text.muted;

  if (inConversation) {
    if (hasPendingPermission) {
      centerText = "⚠ Awaiting approval: y/Enter approve · n/Esc reject";
      centerColor = sc.status.warning;
    } else if (hasPendingQuestion) {
      centerText = "? Awaiting answer: use answer> prompt + Enter · Esc reject";
      centerColor = sc.status.warning;
    } else if (streamingState === ConversationStreamingState.WaitingForConfirmation) {
      centerText = "⚠ Waiting for confirmation";
      centerColor = sc.status.warning;
    } else if (streamingState === ConversationStreamingState.Responding) {
      if (activeTool) {
        centerText = `${spinner} Running ${activeTool.name} (${activeTool.toolIndex}/${activeTool.toolTotal}) · Esc cancel`;
      } else {
        centerText = `${spinner} Thinking · Esc cancel · PgUp/PgDn scroll`;
      }
      centerColor = sc.status.warning;
    } else {
      centerText = "Ready · PgUp/PgDn scroll";
      centerColor = sc.text.muted;
    }

    if (interactionQueueLength > 1) {
      centerText += ` · +${interactionQueueLength - 1} queued`;
    }
    if (queuedUserTurnCount > 0) {
      centerText += ` · +${queuedUserTurnCount} queued message${queuedUserTurnCount === 1 ? "" : "s"}`;
    }
  }

  const rightParts: string[] = [];
  if (contextUsageLabel) rightParts.push(contextUsageLabel);
  if (model) rightParts.push(model);

  return (
    <Box flexGrow={1} flexDirection="row" justifyContent="space-between">
      <Box flexGrow={1} justifyContent="center">
        <Text color={centerColor}>{centerText}</Text>
      </Box>

      <Box flexShrink={0} marginLeft={1}>
        <Text color={sc.text.muted}>
          {rightParts.join(" · ")}
        </Text>
      </Box>
    </Box>
  );
}
