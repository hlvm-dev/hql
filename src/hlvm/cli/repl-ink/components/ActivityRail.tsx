import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../common/utils.ts";
import { useSemanticColors } from "../../theme/index.ts";
import type {
  MemberActivityItem,
  TeamDashboardState,
} from "../hooks/useTeamState.ts";
import type { LocalAgentEntry } from "../utils/local-agents.ts";

const MAX_RAIL_ROWS = 3;

type RailTone = "active" | "warning" | "muted" | "error" | "success";

interface RailRow {
  text: string;
  tone: RailTone;
}

interface CurrentTurnRailItem {
  text: string;
  tone: RailTone;
}

function getStatusTone(status: LocalAgentEntry["status"]): RailTone {
  switch (status) {
    case "failed":
      return "error";
    case "waiting":
      return "warning";
    case "blocked":
      return "muted";
    case "completed":
      return "success";
    case "cancelled":
      return "muted";
    default:
      return "active";
  }
}

function getRecentActivity(
  memberId: string | undefined,
  memberActivity: Record<string, MemberActivityItem[]>,
): string | undefined {
  if (!memberId) return undefined;
  return memberActivity[memberId]?.find((entry) => entry.summary.trim().length > 0)
    ?.summary;
}

export function buildActivityRailRows(input: {
  currentTurn?: CurrentTurnRailItem;
  localAgents: LocalAgentEntry[];
  memberActivity: Record<string, MemberActivityItem[]>;
  teamState: TeamDashboardState;
  width: number;
}): { rows: RailRow[]; overflow?: string } | null {
  const rows: RailRow[] = [];

  if (input.currentTurn?.text.trim()) {
    rows.push({
      text: `turn · ${input.currentTurn.text.trim()}`,
      tone: input.currentTurn.tone,
    });
  }

  for (const entry of input.localAgents) {
    const activity = entry.detail?.trim() ||
      getRecentActivity(entry.memberId, input.memberActivity) ||
      entry.statusLabel;
    rows.push({
      text: `agent · ${entry.name} · ${entry.statusLabel} · ${activity}`,
      tone: getStatusTone(entry.status),
    });
  }

  if (input.teamState.pendingApprovals.length > 0) {
    rows.push({
      text: input.teamState.pendingApprovals.length === 1
        ? "team · 1 plan review waiting"
        : `team · ${input.teamState.pendingApprovals.length} plan reviews waiting`,
      tone: "warning",
    });
  }
  if (input.teamState.shutdowns.some((item) => item.status === "requested")) {
    rows.push({
      text: "team · shutdown request needs attention",
      tone: "warning",
    });
  }
  if (input.teamState.attentionItems.length > 0) {
    rows.push({
      text: input.teamState.attentionItems[0]?.label ?? "team · attention needed",
      tone: "warning",
    });
  }

  if (rows.length === 0) return null;

  const visibleRows = rows.slice(0, MAX_RAIL_ROWS).map((row) => ({
    ...row,
    text: truncate(row.text, Math.max(24, input.width)),
  }));
  const overflow = rows.length > MAX_RAIL_ROWS
    ? truncate(`+${rows.length - MAX_RAIL_ROWS} more`, Math.max(12, input.width))
    : undefined;
  return { rows: visibleRows, overflow };
}

interface ActivityRailProps {
  currentTurn?: CurrentTurnRailItem;
  localAgents: LocalAgentEntry[];
  memberActivity: Record<string, MemberActivityItem[]>;
  teamState: TeamDashboardState;
  width: number;
}

export function ActivityRail(
  props: ActivityRailProps,
): React.ReactElement | null {
  const sc = useSemanticColors();
  const model = buildActivityRailRows(props);

  if (!model) return null;

  const colorForTone = (tone: RailTone): string => {
    switch (tone) {
      case "error":
        return sc.status.error;
      case "warning":
        return sc.status.warning;
      case "success":
        return sc.status.success;
      case "active":
        return sc.text.primary;
      case "muted":
      default:
        return sc.text.muted;
    }
  };

  return (
    <Box flexDirection="column" marginTop={0} marginBottom={0}>
      {model.rows.map((row) => (
        <Text color={colorForTone(row.tone)}>
          {row.text}
        </Text>
      ))}
      {model.overflow && <Text color={sc.text.muted}>{model.overflow}</Text>}
    </Box>
  );
}
