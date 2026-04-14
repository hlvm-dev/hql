import type { ShellHistoryEntry } from "../types.ts";

export function shouldRenderTimelineItem(_item: ShellHistoryEntry): boolean {
  return true;
}

export function filterRenderableTimelineItems<T extends ShellHistoryEntry>(
  items: readonly T[],
): T[] {
  return items.filter((item): item is T => shouldRenderTimelineItem(item));
}
