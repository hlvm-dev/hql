import React from "react";
import Text from "../ink/components/Text.tsx";
import { useTerminalSize } from "../hooks/useTerminalSize.ts";
import { DONOR_INACTIVE } from "../theme/donorTheme.ts";

export function HorizontalRule(): React.ReactNode {
  const { columns } = useTerminalSize();
  return (
    <Text color={DONOR_INACTIVE}>
      {"─".repeat(Math.max(8, columns - 2))}
    </Text>
  );
}
