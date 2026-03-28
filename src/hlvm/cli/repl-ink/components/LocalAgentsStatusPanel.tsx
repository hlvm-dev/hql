import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../common/utils.ts";
import { useSemanticColors } from "../../theme/index.ts";
import type { MemberActivityItem } from "../hooks/useTeamState.ts";
import {
  summarizeLocalAgentFleet,
  type LocalAgentEntry,
} from "../utils/local-agents.ts";

const MAX_VISIBLE_LOCAL_AGENTS = 4;

interface LocalAgentsStatusRow {
  summaryPrefix: string;
  summary: string;
  detailPrefix: string;
  detail: string;
  status: LocalAgentEntry["status"];
}

interface LocalAgentsStatusPanelModel {
  header: string;
  rows: LocalAgentsStatusRow[];
  overflow?: string;
}

function summarizeAgentActivity(
  entry: LocalAgentEntry,
  memberActivity: Record<string, MemberActivityItem[]>,
): string | undefined {
  if (entry.kind !== "teammate" || !entry.memberId) return undefined;
  return memberActivity[entry.memberId]?.find((activity) =>
    activity.summary.trim().length > 0
  )?.summary;
}

function getAgentDetailLine(
  entry: LocalAgentEntry,
  memberActivity: Record<string, MemberActivityItem[]>,
): string {
  if (entry.detail?.trim()) return entry.detail.trim();
  const latestActivity = summarizeAgentActivity(entry, memberActivity);
  if (latestActivity) return latestActivity;
  switch (entry.status) {
    case "waiting":
      return "Waiting for your approval";
    case "blocked":
      return "Blocked by dependencies";
    case "running":
      return "Running in the background (Ctrl+T manager)";
    case "idle":
      return "Waiting for the next task (Ctrl+T manager)";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

function getHeaderText(entries: LocalAgentEntry[]): string {
  const countLabel = entries.length === 1 ? "1 local agent" : `${entries.length} local agents`;
  const statusLabel = summarizeLocalAgentFleet(entries);
  return statusLabel
    ? `• ${countLabel} · ${statusLabel} · Ctrl+T manager`
    : `• ${countLabel} · Ctrl+T manager`;
}

export function getLocalAgentsStatusPanelRowCount(entryCount: number): number {
  if (entryCount <= 0) return 0;
  const visibleCount = Math.min(entryCount, MAX_VISIBLE_LOCAL_AGENTS);
  const overflowCount = Math.max(0, entryCount - visibleCount);
  return 1 + (visibleCount * 2) + (overflowCount > 0 ? 1 : 0);
}

export function buildLocalAgentsStatusPanelModel(
  entries: LocalAgentEntry[],
  memberActivity: Record<string, MemberActivityItem[]>,
  width: number,
): LocalAgentsStatusPanelModel | null {
  if (entries.length === 0) return null;
  const visibleEntries = entries.slice(0, MAX_VISIBLE_LOCAL_AGENTS);
  const overflowCount = Math.max(0, entries.length - visibleEntries.length);
  const hasOverflow = overflowCount > 0;
  const summaryWidth = Math.max(18, width - 3);
  const detailWidth = Math.max(18, width - 5);

  const rows = visibleEntries.map((entry, index) => {
    const isLastVisible = index === visibleEntries.length - 1;
    const summaryPrefix = isLastVisible && !hasOverflow ? "└─" : "├─";
    const detailPrefix = isLastVisible && !hasOverflow ? "   " : "│ ";
    return {
      summaryPrefix,
      summary: truncate(`${entry.name} · ${entry.label}`, summaryWidth),
      detailPrefix,
      detail: truncate(getAgentDetailLine(entry, memberActivity), detailWidth),
      status: entry.status,
    };
  });

  return {
    header: truncate(getHeaderText(entries), Math.max(24, width)),
    rows,
    overflow: hasOverflow
      ? truncate(
        `└─ ${overflowCount} more agents in Ctrl+T manager`,
        Math.max(18, width - 2),
      )
      : undefined,
  };
}

interface LocalAgentsStatusPanelProps {
  entries: LocalAgentEntry[];
  memberActivity: Record<string, MemberActivityItem[]>;
  width: number;
}

export function LocalAgentsStatusPanel(
  { entries, memberActivity, width }: LocalAgentsStatusPanelProps,
): React.ReactElement | null {
  const sc = useSemanticColors();
  const model = useMemo(
    () => buildLocalAgentsStatusPanelModel(entries, memberActivity, width),
    [entries, memberActivity, width],
  );

  if (!model) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={sc.text.primary} bold>{model.header}</Text>
      {model.rows.map((row: LocalAgentsStatusRow, index: number) => {
        const statusColor = row.status === "failed"
          ? sc.status.error
          : row.status === "waiting"
          ? sc.status.warning
          : row.status === "blocked"
          ? sc.text.muted
          : row.status === "completed"
          ? sc.status.success
          : row.status === "cancelled"
          ? sc.text.muted
          : sc.status.warning;
        return (
          <Box key={`${row.summaryPrefix}-${index}`} flexDirection="column">
            <Text color={sc.text.primary}>
              <Text color={sc.text.muted}>{`${row.summaryPrefix} `}</Text>
              {row.summary}
            </Text>
            <Text color={sc.text.muted}>
              {`${row.detailPrefix} `}
              <Text color={statusColor}>⎿</Text>
              {" "}
              {row.detail}
            </Text>
          </Box>
        );
      })}
      {model.overflow && <Text color={sc.text.muted}>{model.overflow}</Text>}
    </Box>
  );
}
