import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";

interface TurnStatsItemType {
  type: "turn_stats";
  id: string;
  toolCount: number;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  modelId?: string;
  status: "completed" | "cancelled" | "failed";
}

const STATUS_ICON: Record<TurnStatsItemType["status"], string> = {
  completed: "✓",
  cancelled: "⊘",
  failed: "✗",
};

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export default function TurnStatsItem({ item }: { item: TurnStatsItemType }) {
  const parts: string[] = [
    STATUS_ICON[item.status],
    formatDuration(item.durationMs),
  ];

  if (item.inputTokens != null || item.outputTokens != null) {
    const tok = [item.inputTokens ?? 0, item.outputTokens ?? 0];
    parts.push(`${tok[0]}→${tok[1]} tok`);
  }

  if (item.toolCount > 0) {
    parts.push(`${item.toolCount} tool${item.toolCount > 1 ? "s" : ""}`);
  }

  if (item.modelId) {
    parts.push(item.modelId);
  }

  return (
    <Box>
      <Text dimColor>{parts.join(" · ")}</Text>
    </Box>
  );
}
