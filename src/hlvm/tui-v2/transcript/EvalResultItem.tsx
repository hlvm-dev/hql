import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";

interface HqlEvalItem {
  type: "hql_eval";
  id: string;
  input: string;
  result: unknown;
  ts: number;
}

function formatResult(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function EvalResultItem({ item }: { item: HqlEvalItem }) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="yellow" bold>{"λ> "}</Text>
        <Text>{item.input}</Text>
      </Box>
      <Box marginLeft={3}>
        <Text color="cyan">{formatResult(item.result)}</Text>
      </Box>
    </Box>
  );
}
