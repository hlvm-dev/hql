import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import { useAppState } from "../state/context.tsx";

export default function StatusLine() {
  const { isLoading, tokenCount, inputMode, activeModelDisplay } =
    useAppState();

  const statusText = isLoading ? "Responding..." : "Ready";
  const modeColor = inputMode === "chat" ? "green" : "yellow";

  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text dimColor>{statusText}</Text>
      <Box>
        {tokenCount > 0 && (
          <Text dimColor>{tokenCount.toLocaleString()} tokens · </Text>
        )}
        <Text color={modeColor}>● </Text>
        <Text dimColor>{inputMode} · {activeModelDisplay}</Text>
      </Box>
    </Box>
  );
}
