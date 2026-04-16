import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";

interface ToolCallDisplay {
  id: string;
  name: string;
  displayName?: string;
  argsSummary: string;
  status: "pending" | "running" | "success" | "error";
  resultSummaryText?: string;
}

interface ToolGroupItemType {
  type: "tool_group";
  id: string;
  tools: ToolCallDisplay[];
  ts: number;
}

const STATUS_ICON: Record<ToolCallDisplay["status"], { icon: string; color?: string }> = {
  pending: { icon: "○" },
  running: { icon: "◑", color: "yellow" },
  success: { icon: "●", color: "green" },
  error: { icon: "✗", color: "red" },
};

export default function ToolGroupItem({ item }: { item: ToolGroupItemType }) {
  return (
    <Box flexDirection="column">
      {item.tools.map((tool) => {
        const { icon, color } = STATUS_ICON[tool.status];
        const label = tool.displayName ?? tool.name;
        return (
          <Box key={tool.id}>
            <Text color={color}>{icon} </Text>
            <Text bold>{label}</Text>
            <Text dimColor>{" " + tool.argsSummary}</Text>
            {tool.resultSummaryText && (
              <Text dimColor>{" → " + tool.resultSummaryText}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
