import { truncate } from "../../../../../common/utils.ts";
import { formatDurationMs } from "../../utils/formatting.ts";
import { stringWidth } from "../../../../tui-v2/ink/stringWidth.ts";

export interface ToolCallTextLayout {
  labelText: string;
  suffixText: string;
  durationText: string;
  gapWidth: number;
}

export function buildToolCallTextLayout(
  width: number,
  label: string,
  durationMs?: number,
  suffix?: string,
): ToolCallTextLayout {
  const shouldRenderDuration = durationMs != null && durationMs >= 1000;
  const fullDurationText = shouldRenderDuration
    ? `· ${formatDurationMs(durationMs)}`
    : "";
  const fullDurationWidth = stringWidth(fullDurationText);
  const durationText = fullDurationWidth > 0 &&
      width >= fullDurationWidth + 2
    ? fullDurationText
    : "";
  const durationWidth = stringWidth(durationText);
  const minLabelWidth = Math.min(14, Math.max(6, Math.floor(width * 0.28)));
  const rawSuffix = suffix?.trim() ?? "";
  const suffixBudget = Math.max(
    0,
    width - durationWidth - (durationText ? 1 : 0) - minLabelWidth,
  );
  const suffixText = rawSuffix && suffixBudget >= 6
    ? ` · ${truncate(rawSuffix, suffixBudget - 3, "…")}`
    : "";
  const suffixWidth = stringWidth(suffixText);
  const availableLabelWidth = Math.max(
    1,
    width - durationWidth - suffixWidth - (durationText ? 1 : 0),
  );
  const labelText = truncate(label, availableLabelWidth, "…");
  const labelWidth = stringWidth(labelText);
  const usedWidth = labelWidth + suffixWidth + durationWidth;
  const gapWidth = durationText ? Math.max(1, width - usedWidth) : 0;

  return {
    labelText,
    suffixText,
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

  // Always show: first 2, last 1, all errors, and the latest active tool.
  const visible = new Set<number>();
  visible.add(0);
  visible.add(1);
  visible.add(tools.length - 1);
  let latestRunningIndex: number | undefined;
  let latestPendingIndex: number | undefined;
  for (let i = 0; i < tools.length; i++) {
    if (tools[i].status === "error") visible.add(i);
    if (tools[i].status === "running") latestRunningIndex = i;
    if (tools[i].status === "pending") latestPendingIndex = i;
  }
  if (latestRunningIndex !== undefined) {
    visible.add(latestRunningIndex);
  } else if (latestPendingIndex !== undefined) {
    visible.add(latestPendingIndex);
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
