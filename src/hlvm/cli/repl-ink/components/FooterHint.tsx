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

interface FooterProps {
  streamingState?: StreamingState;
  activeTool?: { name: string; toolIndex: number; toolTotal: number };
  modelName?: string;
  /** Compact context/tokens indicator (e.g., "35% ctx", "4.2k tok") */
  contextUsageLabel?: string;
  /** Number of queued interactions */
  interactionQueueLength?: number;
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
  inConversation,
  hasPendingPermission,
  hasPendingQuestion,
}: FooterProps): React.ReactElement {
  const sc = useSemanticColors();
  const model = modelName ?? "";

  let centerText = "";
  let centerColor = sc.text.muted;

  if (inConversation) {
    if (hasPendingPermission) {
      centerText = "Awaiting approval: y/Enter approve · n/Esc reject";
      centerColor = sc.status.warning;
    } else if (hasPendingQuestion) {
      centerText = "Awaiting answer: type response + Enter · Esc reject";
      centerColor = sc.status.warning;
    } else if (streamingState === ConversationStreamingState.WaitingForConfirmation) {
      centerText = "Waiting for confirmation";
      centerColor = sc.status.warning;
    } else if (streamingState === ConversationStreamingState.Responding && activeTool) {
      // Show tool progress in footer only when we have a concrete running tool.
      // Generic "Thinking..." is rendered in the conversation panel to avoid duplication.
      centerText = `Running ${activeTool.name} (${activeTool.toolIndex}/${activeTool.toolTotal})`;
      centerColor = sc.status.warning;
    } else {
      centerText = "Esc: exit · PgUp/PgDn: scroll";
      centerColor = sc.text.muted;
    }

    if (interactionQueueLength > 1) {
      centerText += ` · +${interactionQueueLength - 1} queued`;
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
