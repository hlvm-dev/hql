/**
 * Footer Component
 *
 * Rich three-section footer: branding + model | agent status | keyboard shortcuts.
 * Context-sensitive: shows different hints during conversation vs normal REPL.
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

  // Build context-sensitive shortcut hints
  let hints: string;
  if (hasPendingPermission) {
    hints = "y/Enter: approve | n/Esc: reject";
  } else if (hasPendingQuestion) {
    hints = "Type answer + Enter";
  } else if (agentStatus && agentStatus.type !== "idle") {
    hints = inConversation
      ? "Esc: cancel | Ctrl+O: toggle section (empty prompt) | PgUp/PgDn: scroll"
      : "Esc: cancel";
  } else if (inConversation) {
    hints = "Ctrl+O: toggle section (empty prompt) | PgUp/PgDn: scroll";
  } else {
    hints = "Ctrl+P | Tab | Ctrl+R";
  }
  if (interactionQueueLength > 1) {
    hints += ` | +${interactionQueueLength - 1} queued`;
  }

  return (
    <Box flexGrow={1} flexDirection="row" justifyContent="space-between">
      {/* Left: branding + model */}
      <Box>
        <Text color={sc.text.muted}>hlvm</Text>
        {model && (
          <Text color={sc.text.secondary}> · {model}</Text>
        )}
      </Box>

      {/* Center: agent status */}
      <Box flexGrow={1} justifyContent="center">
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
      </Box>

      {/* Right: context-sensitive keyboard shortcuts */}
      <Box>
        <Text color={sc.text.muted}>
          {contextUsageLabel ? `${contextUsageLabel} · ` : ""}
          {hints}
        </Text>
      </Box>
    </Box>
  );
}
