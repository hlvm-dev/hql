import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";

interface AssistantItem {
  type: "assistant";
  id: string;
  text: string;
  isPending: boolean;
  ts: number;
}

export default function AssistantMessage({ item }: { item: AssistantItem }) {
  return (
    <Box flexDirection="column">
      <Text>{item.text}</Text>
      {item.isPending && <Text dimColor>...</Text>}
    </Box>
  );
}
