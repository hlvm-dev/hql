import { truncate } from "../../../../../common/utils.ts";
import { formatDurationMs } from "../../utils/formatting.ts";

export interface ToolCallTextLayout {
  labelText: string;
  durationText: string;
  gapWidth: number;
}

export function buildToolCallTextLayout(
  width: number,
  label: string,
  durationMs?: number,
): ToolCallTextLayout {
  const shouldRenderDuration = durationMs != null && durationMs >= 1000;
  const fullDurationText = shouldRenderDuration
    ? `· ${formatDurationMs(durationMs)}`
    : "";
  const durationText = fullDurationText.length > 0 &&
      width >= fullDurationText.length + 2
    ? fullDurationText
    : "";
  const availableLabelWidth = Math.max(
    1,
    width - durationText.length - (durationText ? 1 : 0),
  );
  const labelText = truncate(label, availableLabelWidth, "…");
  const usedWidth = labelText.length + durationText.length;
  const gapWidth = durationText ? Math.max(1, width - usedWidth) : 0;

  return {
    labelText,
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

  // Always show: first 2, last 1, all errors, all running
  const visible = new Set<number>();
  visible.add(0);
  visible.add(1);
  visible.add(tools.length - 1);
  for (let i = 0; i < tools.length; i++) {
    if (tools[i].status === "error") visible.add(i);
    if (tools[i].status === "running") visible.add(i);
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
