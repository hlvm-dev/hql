/**
 * ToolStatusIcon Component
 *
 * Renders a single status icon for a tool call.
 * Uses ⏺ (record) glyph for all states, static marker for running.
 * No spinner subscription — avoids terminal redraws that break text selection.
 */

import React from "react";
import { Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";

const TOOL_GLYPH = "\u23FA"; // ⏺

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
      return <Text color={sc.text.muted}>{TOOL_GLYPH}</Text>;
    case "running":
      return <Text color={sc.tool.running}>{TOOL_GLYPH}</Text>;
    case "success":
      return <Text color={sc.text.muted}>{TOOL_GLYPH}</Text>;
    case "error":
      return <Text color={sc.tool.error}>{TOOL_GLYPH}</Text>;
  }
});
