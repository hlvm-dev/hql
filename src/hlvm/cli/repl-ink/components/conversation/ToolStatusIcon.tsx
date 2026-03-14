/**
 * ToolStatusIcon Component
 *
 * Renders a single status icon for a tool call.
 * pending: ○, running: animated spinner, success: ✓, error: ✗
 */

import React from "react";
import { Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";


interface ToolStatusIconProps {
  status: "pending" | "running" | "success" | "error";
}

export const ToolStatusIcon = React.memo(function ToolStatusIcon({ status }: ToolStatusIconProps): React.ReactElement {
  const sc = useSemanticColors();
  switch (status) {
    case "pending":
      return <Text color={sc.text.muted}>○</Text>;
    case "running":
      return <Text color={sc.tool.running}>·</Text>;
    case "success":
      return <Text color={sc.tool.success}>✓</Text>;
    case "error":
      return <Text color={sc.tool.error}>✗</Text>;
  }
});
