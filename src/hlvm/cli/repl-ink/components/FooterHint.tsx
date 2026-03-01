/**
 * Footer Component
 *
 * Minimal footer: model name right-aligned.
 * Shows agent status + interaction hints only during conversation mode.
 */

import React from "react";
import { Text, Box } from "ink";
import { useSemanticColors } from "../../theme/index.ts";
import { BRAILLE_SPINNER_FRAMES } from "../ui-constants.ts";
import { useSpinnerFrame } from "../hooks/useSpinnerFrame.ts";
import type { AgentFooterStatus } from "../types.ts";

// ============================================================
// Types
// ============================================================

interface FooterProps {
  agentStatus?: AgentFooterStatus;
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

// ============================================================
// Component
// ============================================================

export function FooterHint({
  agentStatus,
  modelName,
  contextUsageLabel,
  interactionQueueLength = 0,
  inConversation,
  hasPendingPermission,
  hasPendingQuestion,
}: FooterProps): React.ReactElement {
  const sc = useSemanticColors();
  const model = modelName ?? "";

  // Spinner animation for thinking/running states
  const isAnimating = agentStatus?.type === "thinking" ||
    agentStatus?.type === "running_tool";
  const frame = useSpinnerFrame(isAnimating);

  // Conversation-mode hints (only shown during agent interactions)
  let conversationHints = "";
  if (hasPendingPermission) {
    conversationHints = "y/Enter: approve | n/Esc: reject";
  } else if (hasPendingQuestion) {
    conversationHints = "Type answer + Enter | Esc: reject";
  } else if (agentStatus && agentStatus.type !== "idle") {
    conversationHints = inConversation
      ? "Esc: cancel | PgUp/PgDn: scroll"
      : "Esc: cancel";
  } else if (inConversation) {
    conversationHints = "Esc: exit | PgUp/PgDn: scroll";
  }
  if (interactionQueueLength > 1) {
    conversationHints += ` | +${interactionQueueLength - 1} queued`;
  }

  return (
    <Box flexGrow={1} flexDirection="row" justifyContent="flex-end">
      {/* Agent status (conversation mode only) */}
      {inConversation && (
        <Box flexGrow={1}>
          {agentStatus?.type === "thinking" && (
            <Text color={sc.status.warning}>
              {BRAILLE_SPINNER_FRAMES[frame]} Thinking...
            </Text>
          )}
          {agentStatus?.type === "running_tool" && (
            <Text color={sc.status.warning}>
              {BRAILLE_SPINNER_FRAMES[frame]} Running {agentStatus.toolName} ({agentStatus.toolIndex}/{agentStatus.toolTotal})
            </Text>
          )}
          {conversationHints && (
            <Box justifyContent="flex-end" flexGrow={1}>
              <Text color={sc.text.muted}>{conversationHints}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Model name — always right-aligned */}
      {model && (
        <Text color={sc.text.muted}>
          {contextUsageLabel ? `${contextUsageLabel} · ` : ""}{model}
        </Text>
      )}
    </Box>
  );
}
