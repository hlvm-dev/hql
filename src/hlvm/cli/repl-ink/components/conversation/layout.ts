import { truncate } from "../../../../../common/utils.ts";
import { formatDurationMs } from "../../utils/formatting.ts";

export interface ToolCallTextLayout {
  argsText: string;
  durationText: string;
  gapWidth: number;
}

export function buildToolCallTextLayout(
  width: number,
  toolName: string,
  argsSummary: string,
  durationMs?: number,
): ToolCallTextLayout {
  const shouldRenderDuration = durationMs != null && durationMs >= 1000;
  const fullDurationText = shouldRenderDuration
    ? `· (${formatDurationMs(durationMs)})`
    : "";
  const durationText = fullDurationText.length > 0 &&
      width - toolName.length >= fullDurationText.length + 1
    ? fullDurationText
    : "";
  const reservedGapWidth = durationText ? 1 : 0;
  const availableArgsWidth = Math.max(
    0,
    width - toolName.length - durationText.length - reservedGapWidth - 1,
  );
  const argsText = argsSummary && availableArgsWidth > 0
    ? truncate(argsSummary, availableArgsWidth, "…")
    : "";
  const usedWidth = toolName.length + (argsText ? 1 + argsText.length : 0) +
    durationText.length;
  const gapWidth = durationText ? Math.max(1, width - usedWidth) : 0;

  return {
    argsText,
    durationText,
    gapWidth,
  };
}

export interface CollapsedToolList {
  visibleTools: number[];
  hiddenCount: number;
}

export function resolveCollapsedToolList(
  tools: Array<{ status: string }>,
  maxVisible = 5,
): CollapsedToolList | null {
  if (tools.length <= maxVisible) return null;
  if (tools.some((t) => t.status === "running")) return null;

  // Always show: first 2, last 1, all errors
  const visible = new Set<number>();
  visible.add(0);
  visible.add(1);
  visible.add(tools.length - 1);
  for (let i = 0; i < tools.length; i++) {
    if (tools[i].status === "error") visible.add(i);
  }

  // Fill up to maxVisible from the start
  if (visible.size < maxVisible) {
    for (let i = 0; i < tools.length && visible.size < maxVisible; i++) {
      visible.add(i);
    }
  }

  const sortedVisible = [...visible].sort((a, b) => a - b);
  const hiddenCount = tools.length - sortedVisible.length;
  if (hiddenCount <= 0) return null;

  return { visibleTools: sortedVisible, hiddenCount };
}
