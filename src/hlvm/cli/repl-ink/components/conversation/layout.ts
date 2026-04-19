import { truncate } from "../../../../../common/utils.ts";
import { formatDurationMs } from "../../utils/formatting.ts";
import { stringWidth } from "../../../../tui-v2/ink/stringWidth.ts";

export interface ToolCallTextLayout {
  labelText: string;
  suffixText: string;
  durationText: string;
  gapWidth: number;
}

function buildToolCallLayoutCandidate(
  width: number,
  label: string,
  rawSuffix: string,
  durationText: string,
  minLabelWidth: number,
): ToolCallTextLayout {
  const durationWidth = stringWidth(durationText);
  const minGapWidth = durationText ? 1 : 0;
  const suffixBudget = Math.max(
    0,
    width - durationWidth - minGapWidth - minLabelWidth,
  );
  const suffixText = rawSuffix && suffixBudget >= 6
    ? ` · ${truncate(rawSuffix, suffixBudget - 3, "…")}`
    : "";
  const suffixWidth = stringWidth(suffixText);
  const availableLabelWidth = Math.max(
    1,
    width - durationWidth - suffixWidth - minGapWidth,
  );
  const labelText = truncate(label, availableLabelWidth, "…");
  const labelWidth = stringWidth(labelText);
  const usedWithoutGap = labelWidth + suffixWidth + durationWidth;
  const gapWidth = durationText
    ? suffixText
      ? 1
      : Math.max(1, width - usedWithoutGap)
    : 0;

  return {
    labelText,
    suffixText,
    durationText,
    gapWidth,
  };
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
  const rawSuffix = suffix?.trim() ?? "";
  const minLabelWidth = Math.min(12, Math.max(6, Math.floor(width * 0.22)));
  const withoutDuration = buildToolCallLayoutCandidate(
    width,
    label,
    rawSuffix,
    "",
    minLabelWidth,
  );
  if (!fullDurationText || width < stringWidth(fullDurationText) + 2) {
    return withoutDuration;
  }

  const withDuration = buildToolCallLayoutCandidate(
    width,
    label,
    rawSuffix,
    fullDurationText,
    minLabelWidth,
  );
  if (!rawSuffix) {
    return withDuration;
  }

  return stringWidth(withoutDuration.suffixText) >
      stringWidth(withDuration.suffixText)
    ? withoutDuration
    : withDuration;
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
