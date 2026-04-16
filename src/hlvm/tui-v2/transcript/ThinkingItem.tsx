import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";

interface ThinkingItemType {
  type: "thinking";
  id: string;
  kind: "reasoning" | "planning";
  summary: string;
  iteration: number;
}

export default function ThinkingItem({ item }: { item: ThinkingItemType }) {
  const label =
    item.kind === "planning" ? `Planning: ${item.summary}` : "Thinking...";

  return (
    <Box>
      <Text dimColor italic>
        {label}
      </Text>
    </Box>
  );
}
