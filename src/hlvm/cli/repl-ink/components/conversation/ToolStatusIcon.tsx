/**
 * ToolStatusIcon Component
 *
 * Renders a single status icon for a tool call.
 * Uses a small bullet glyph for all states.
 * No spinner subscription — avoids terminal redraws that break text selection.
 */

import React from "react";
import { Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { useConversationSpinnerFrame } from "../../hooks/useConversationMotion.ts";

interface ToolStatusIconProps {
  status: "pending" | "running" | "success" | "error";
  animate?: boolean;
  activityColor?: string;
}

export const ToolStatusIcon = React.memo(function ToolStatusIcon({
  status,
  animate = false,
  activityColor,
}: ToolStatusIconProps): React.ReactElement {
  const sc = useSemanticColors();
  const normalColor = activityColor ?? sc.tool.success;
  const spinner = useConversationSpinnerFrame(status === "running" && animate);
  switch (status) {
    case "pending":
      return <Text color={sc.text.muted}>·</Text>;
    case "running":
      return <Text color={normalColor}>{spinner ?? "●"}</Text>;
    case "success":
      return <Text color={normalColor}>●</Text>;
    case "error":
      return <Text color={sc.tool.error}>●</Text>;
  }
});
