/**
 * ToolStatusIcon Component
 *
 * Renders a single status icon for a tool call.
 * pending: ○, running: animated spinner, success: ✓, error: ✗
 */

import React from "react";
import { Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { BRAILLE_SPINNER_FRAMES } from "../../ui-constants.ts";
import { useSpinnerFrame } from "../../hooks/useSpinnerFrame.ts";

interface ToolStatusIconProps {
  status: "pending" | "running" | "success" | "error";
}

export function ToolStatusIcon({ status }: ToolStatusIconProps): React.ReactElement {
  const sc = useSemanticColors();
  const frame = useSpinnerFrame(status === "running");

  switch (status) {
    case "pending":
      return <Text color={sc.text.muted}>○</Text>;
    case "running":
      return <Text color={sc.tool.running}>{BRAILLE_SPINNER_FRAMES[frame]}</Text>;
    case "success":
      return <Text color={sc.tool.success}>✓</Text>;
    case "error":
      return <Text color={sc.tool.error}>✗</Text>;
  }
}
