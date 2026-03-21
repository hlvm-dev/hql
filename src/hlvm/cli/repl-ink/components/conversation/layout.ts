import { truncate } from "../../../../../common/utils.ts";
import { formatDurationMs, padTo } from "../../utils/formatting.ts";

export interface ToolCallTextLayout {
  argsText: string;
  durationText: string;
  gapWidth: number;
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
