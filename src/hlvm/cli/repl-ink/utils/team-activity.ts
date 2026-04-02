import type { MemberActivityItem } from "../hooks/useTeamState.ts";

export function findRecentActivityItem(
  activities: MemberActivityItem[] | undefined,
): MemberActivityItem | undefined {
  return activities?.find((activity) => activity.summary.trim().length > 0);
}

export interface MemberActivityProgress {
  activityText?: string;
  previewLines: string[];
  toolUseCount?: number;
  tokenCount?: number;
  durationMs?: number;
}

export function listRecentMemberActivitySummaries(
  activities: MemberActivityItem[] | undefined,
  limit = 3,
): string[] {
  if (!activities?.length) return [];
  return activities
    .map((entry) => entry.summary.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function getRecentMemberActivityLines(
  activities: MemberActivityItem[] | undefined,
  limit = 6,
): string[] {
  const summaries = listRecentMemberActivitySummaries(activities, limit);
  if (summaries.length === 0) return [];
  return [
    "Recent activity:",
    ...summaries.map((entry) => `- ${entry}`),
  ];
}

export function deriveMemberActivityProgress(
  activities: MemberActivityItem[] | undefined,
): MemberActivityProgress {
  const summaries = listRecentMemberActivitySummaries(activities, 4);
  const activityText = summaries[0];
  const latestTurnStats = activities?.find((entry) =>
    entry.activityKind === "turn_stats" &&
    (
      entry.toolCount != null ||
      entry.inputTokens != null ||
      entry.outputTokens != null ||
      entry.durationMs != null
    )
  );
  const latestDuration = activities?.find((entry) => entry.durationMs != null);
  const tokenCount = latestTurnStats
    ? (latestTurnStats.inputTokens ?? 0) + (latestTurnStats.outputTokens ?? 0)
    : undefined;
  const toolUseCount = latestTurnStats?.toolCount ??
    activities?.filter((entry) => entry.activityKind === "tool_end").length;

  return {
    activityText,
    previewLines: summaries.slice(1, 4),
    toolUseCount: toolUseCount && toolUseCount > 0 ? toolUseCount : undefined,
    tokenCount: tokenCount && tokenCount > 0 ? tokenCount : undefined,
    durationMs: latestTurnStats?.durationMs ?? latestDuration?.durationMs,
  };
}

export function getRecentMemberActivitySummary(
  memberId: string | undefined,
  memberActivity: Record<string, MemberActivityItem[]>,
): string | undefined {
  return memberId
    ? findRecentActivityItem(memberActivity[memberId])?.summary
    : undefined;
}
