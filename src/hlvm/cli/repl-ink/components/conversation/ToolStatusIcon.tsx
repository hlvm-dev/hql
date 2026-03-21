/**
 * ToolStatusIcon Component
 *
 * Renders a single status icon for a tool call.
 * pending: ○, running: animated spinner, success: ✓, error: ✗
 */

import React from "react";
import { Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { useConversationSpinnerFrame } from "../../hooks/useConversationMotion.ts";
import { STATUS_GLYPHS } from "../../ui-constants.ts";

interface ToolStatusIconProps {
  status: "pending" | "running" | "success" | "error";
  animate?: boolean;
}

export const ToolStatusIcon = React.memo(function ToolStatusIcon({
  status,
  animate = false,
}: ToolStatusIconProps): React.ReactElement {
  const sc = useSemanticColors();
  const spinnerFrame = useConversationSpinnerFrame(
    status === "running" && animate,
  );
  switch (status) {
    case "pending":
      return <Text color={sc.text.muted}>{STATUS_GLYPHS.pending}</Text>;
    case "running":
      return (
        <Text color={sc.tool.running}>
          {spinnerFrame ?? STATUS_GLYPHS.running}
        </Text>
      );
    case "success":
      return <Text color={sc.tool.success}>{STATUS_GLYPHS.success}</Text>;
    case "error":
      return <Text color={sc.tool.error}>{STATUS_GLYPHS.error}</Text>;
  }
});
