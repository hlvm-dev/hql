import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../common/utils.ts";
import type { QueuedLocalEval } from "../types.ts";
import { useSemanticColors } from "../../theme/index.ts";

interface LocalEvalQueuePreviewProps {
  items: QueuedLocalEval[];
  width: number;
}

export function LocalEvalQueuePreview(
  { items, width }: LocalEvalQueuePreviewProps,
): React.ReactElement | null {
  const sc = useSemanticColors();
  if (items.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={2}>
      <Text color={sc.text.muted}>
        {items.length} local eval{items.length === 1 ? "" : "s"} queued
      </Text>
      {items.slice(0, 3).map((item: QueuedLocalEval) => (
        <Text key={item.id} color={sc.text.secondary}>
          {truncate("> " + item.input, Math.max(12, width - 4), "...")}
        </Text>
      ))}
      {items.length > 3 && (
        <Text color={sc.text.muted}>
          +{items.length - 3} more
        </Text>
      )}
    </Box>
  );
}
