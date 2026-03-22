import { truncate } from "../../../../../common/utils.ts";
import { formatDurationMs, padTo } from "../../utils/formatting.ts";

export interface ToolCallTextLayout {
  argsText: string;
  durationText: string;
  gapWidth: number;
}

export interface TurnStatsTextLayout {
  text: string;
  leftRuleWidth: number;
  rightRuleWidth: number;
}

export function buildToolGroupCountSlot(
  completed: number,
  total: number,
  isAllDone: boolean,
): string {
  const slotWidth = Math.max(
    `(${total})`.length,
    `(${total}/${total})`.length,
  );
  const label = isAllDone ? `(${total})` : `(${completed}/${total})`;
  return padTo(label, slotWidth);
}

export function buildToolGroupProgressSlot(
  completed: number,
  total: number,
): string {
  const slotWidth = `${total}/${total}`.length;
  return padTo(`${completed}/${total}`, slotWidth);
}

export function buildToolCallTextLayout(
  width: number,
  toolName: string,
  argsSummary: string,
  durationMs?: number,
): ToolCallTextLayout {
  const fullDurationText = durationMs != null
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

export function buildTurnStatsTextLayout(
  width: number,
  parts: string[],
): TurnStatsTextLayout {
  const safeWidth = Math.max(0, width);
  if (safeWidth === 0) {
    return { text: "", leftRuleWidth: 0, rightRuleWidth: 0 };
  }

  const summary = truncate(parts.filter(Boolean).join(" · "), safeWidth, "…");
  if (summary.length >= safeWidth) {
    return { text: summary, leftRuleWidth: 0, rightRuleWidth: 0 };
  }

  const remaining = Math.max(0, safeWidth - summary.length - 2);
  const leftRuleWidth = Math.floor(remaining / 2);
  const rightRuleWidth = remaining - leftRuleWidth;

  return {
    text: summary,
    leftRuleWidth,
    rightRuleWidth,
  };
}
