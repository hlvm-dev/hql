import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";

type Props = {
  hasStash: boolean;
};

export function PromptInputStashNotice(
  { hasStash }: Props,
): React.ReactNode {
  if (!hasStash) {
    return null;
  }

  return (
    <Box paddingLeft={2}>
      <Text dimColor>{">"} Stashed (auto-restores after submit)</Text>
    </Box>
  );
}
