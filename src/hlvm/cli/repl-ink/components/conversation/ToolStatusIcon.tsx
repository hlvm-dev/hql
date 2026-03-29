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

interface ToolStatusIconProps {
  status: "pending" | "running" | "success" | "error";
  animate?: boolean;
}

export const ToolStatusIcon = React.memo(function ToolStatusIcon({
  status,
}: ToolStatusIconProps): React.ReactElement {
  const sc = useSemanticColors();
  switch (status) {
    case "pending":
      return <Text color={sc.text.muted}>○</Text>;
    case "running":
      return <Text color={sc.tool.running}>●</Text>;
    case "success":
      return <Text color={sc.tool.success}>✓</Text>;
    case "error":
      return <Text color={sc.tool.error}>✗</Text>;
  }
});
