import { isStructuredTeamInfoItem, type ShellHistoryEntry } from "../types.ts";

export function shouldRenderTimelineItem(item: ShellHistoryEntry): boolean {
  return !(
    isStructuredTeamInfoItem(item) &&
    (
      item.teamEventType === "team_member_activity" ||
      item.teamEventType === "team_runtime_snapshot"
    )
  );
}

export function filterRenderableTimelineItems<T extends ShellHistoryEntry>(
  items: readonly T[],
): T[] {
  return items.filter((item): item is T => shouldRenderTimelineItem(item));
}
