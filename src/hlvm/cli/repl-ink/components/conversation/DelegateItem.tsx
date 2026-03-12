import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../../common/utils.ts";
import { useSemanticColors } from "../../../theme/index.ts";
import { formatDurationMs } from "../../utils/formatting.ts";
import type { DelegateItem as DelegateItemData } from "../../types.ts";
import type { DelegateTranscriptEvent } from "../../../../agent/delegate-transcript.ts";

interface DelegateItemProps {
  item: DelegateItemData;
  width: number;
  expanded?: boolean;
}

export const DelegateItem = React.memo(function DelegateItem(
  { item, width, expanded = false }: DelegateItemProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const accentMap: Record<string, string> = {
    error: sc.status.error,
    success: sc.status.success,
    cancelled: sc.text.muted,
    queued: sc.text.muted,
  };
  const iconMap: Record<string, string> = {
    error: "✗",
    success: "✓",
    cancelled: "○",
    queued: "⏳",
  };
  const accent = accentMap[item.status] ?? sc.status.warning;
  const icon = iconMap[item.status] ?? "↗";
  const duration = item.durationMs != null
    ? ` · ${formatDurationMs(item.durationMs)}`
    : "";
  const body = item.status === "error"
    ? item.error
    : item.status === "cancelled"
    ? "Cancelled"
    : item.summary;

  // Show nickname in header when available
  const header = item.nickname
    ? `${item.nickname} [${item.agent}]`
    : `Delegate ${item.agent}`;

  return (
    <Box flexDirection="row" width={width} marginBottom={1}>
      <Box width={4} flexShrink={0}>
        <Text color={accent} bold>{icon}</Text>
      </Box>
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="single"
        borderLeft
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderColor={accent}
        paddingLeft={1}
      >
        <Text bold color={accent}>
          {truncate(header, Math.max(10, width - 8), "…")}
        </Text>
        <Text color={sc.text.secondary}>
          {truncate(item.task, Math.max(10, width - 8), "…")}
          {duration}
        </Text>
        {body && (
          <Text
            color={item.status === "error" ? sc.status.error : sc.text.muted}
          >
            {truncate(body, Math.max(10, width - 8), "…")}
          </Text>
        )}
        {item.childSessionId && (
          <Text color={sc.text.muted}>
            {truncate(
              `child session: ${item.childSessionId}`,
              Math.max(10, width - 8),
              "…",
            )}
          </Text>
        )}
        {expanded && item.snapshot && (
          <Box flexDirection="column" marginTop={1}>
            {item.snapshot.events.map((event, index) => (
              <React.Fragment key={`${item.id}-event-${index}`}>
                <Text color={sc.text.muted}>
                  {truncate(
                    formatSnapshotEvent(event),
                    Math.max(10, width - 8),
                    "…",
                  )}
                </Text>
              </React.Fragment>
            ))}
            {item.snapshot.finalResponse && (
              <Text color={sc.text.primary}>
                {truncate(
                  `Final: ${item.snapshot.finalResponse}`,
                  Math.max(10, width - 8),
                  "…",
                )}
              </Text>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
});

function formatSnapshotEvent(event: DelegateTranscriptEvent): string {
  switch (event.type) {
    case "reasoning":
      return `Reasoning: ${event.summary.trim()}`;
    case "planning":
      return `Planning: ${event.summary.trim()}`;
    case "plan_created":
      return `Plan created (${event.stepCount} steps)`;
    case "plan_step":
      return `Plan step ${event.index + 1} complete: ${event.stepId}`;
    case "tool_start":
      return `Tool ${event.name}: ${event.argsSummary}`;
    case "tool_end":
      return event.success
        ? `Tool ${event.name}: ${event.summary ?? "completed"}`
        : `Tool ${event.name} failed: ${
          event.summary ?? event.content ?? "error"
        }`;
    case "turn_stats":
      return `${event.toolCount} tool${event.toolCount === 1 ? "" : "s"} · ${
        formatDurationMs(event.durationMs)
      }`;
  }
  return "";
}
