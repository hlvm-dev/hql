import { truncate } from "../../../../common/utils.ts";
import { formatProgressBar } from "./formatting.ts";
import { stringWidth } from "../../../tui-v2/ink/stringWidth.ts";

export const SHELL_SEGMENT_SEPARATOR = " · ";

type ShellFooterSegmentTone =
  | "neutral"
  | "active"
  | "warning"
  | "error"
  | "muted";

export interface ShellFooterSegment {
  text: string;
  tone: ShellFooterSegmentTone;
  chip?: boolean;
}

export interface ShellQueuePreviewLine {
  kind: "header" | "item" | "overflow" | "hint";
  text: string;
  tone: "neutral" | "muted" | "hint";
  chip?: boolean;
}

export function getHistorySearchMatchLabel(
  query: string,
  matchCount: number,
  selectedIndex: number,
): string {
  if (!query.trim()) return "type to search";
  if (matchCount === 0) return "no match";
  if (matchCount === 1) return "1 match";
  return `${selectedIndex + 1}/${matchCount} matches`;
}

export function getHistorySearchHintText(
  query: string,
  matchCount: number,
): string {
  if (!query.trim()) return "Type search · Esc";
  if (matchCount <= 1) return "Enter select · Esc";
  return "Ctrl+R next · Ctrl+S prev · Enter · Esc";
}

export function getShellPromptSlotWidth(promptLabel = ""): number {
  return stringWidth(promptLabel);
}

export function getShellPromptPrefixWidth(promptLabel = ""): number {
  return getShellPromptSlotWidth(promptLabel) + 1;
}

export function padShellPromptLabel(promptLabel: string): string {
  return promptLabel.padEnd(getShellPromptSlotWidth(promptLabel), " ");
}

export function summarizeModeLabel(modeLabel?: string): string | undefined {
  if (!modeLabel) return undefined;
  return modeLabel.replace(/\s*\([^)]*\)\s*$/, "").trim() || undefined;
}

function joinShellText(
  parts: Array<string | undefined | null | false>,
): string {
  return parts.filter((part): part is string => Boolean(part && part.trim()))
    .join(SHELL_SEGMENT_SEPARATOR);
}

export function formatShellFooterText(segments: ShellFooterSegment[]): string {
  return joinShellText(segments.map((segment) => segment.text));
}

function measureShellFooterSegments(
  segments: ShellFooterSegment[],
): number {
  return segments.reduce((total, segment, index) => {
    const separatorWidth = index > 0 ? SHELL_SEGMENT_SEPARATOR.length : 0;
    const chipPadding = segment.chip ? 2 : 0;
    return total + separatorWidth + stringWidth(segment.text) + chipPadding;
  }, 0);
}

export function fitShellFooterSegments(
  segments: ShellFooterSegment[],
  maxWidth: number,
): ShellFooterSegment[] {
  const safeWidth = Math.max(0, maxWidth);
  if (safeWidth === 0) return [];
  if (measureShellFooterSegments(segments) <= safeWidth) return segments;

  const fitted = segments.slice();
  while (fitted.length > 0 && measureShellFooterSegments(fitted) > safeWidth) {
    const actualIndex = fitted.findLastIndex((segment) => !segment.chip);
    if (actualIndex === -1) {
      fitted.pop();
      continue;
    }
    const prefix = fitted.slice(0, actualIndex);
    const prefixWidth = measureShellFooterSegments(prefix) +
      (prefix.length > 0 ? SHELL_SEGMENT_SEPARATOR.length : 0);
    const available = safeWidth - prefixWidth;

    if (available <= 1) {
      fitted.splice(actualIndex, 1);
      continue;
    }

    const nextText = truncate(fitted[actualIndex].text, available, "…");
    if (nextText.length === 0) {
      fitted.splice(actualIndex, 1);
      continue;
    }

    fitted[actualIndex] = {
      ...fitted[actualIndex],
      text: nextText,
    };

    if (measureShellFooterSegments(fitted) <= safeWidth) {
      return fitted;
    }

    fitted.splice(actualIndex, 1);
  }

  return fitted;
}

export function buildContextUsageMiniBar(
  label: string,
  barWidth = 8,
): string {
  const match = label.match(/^(.*?)(\d+)%\s*(.*)$/);
  if (!match) return label;
  const prefix = match[1]?.trim();
  const pct = Math.max(0, Math.min(100, Number(match[2])));
  const suffix = match[3]?.trim();
  return [prefix, `[${formatProgressBar(pct, barWidth)}] ${pct}%`, suffix]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(" ");
}

export function buildQueuePreviewHintLine(
  editBindingLabel: string,
): ShellQueuePreviewLine {
  return {
    kind: "hint",
    text: `${editBindingLabel} edit last queued input`,
    tone: "hint",
  };
}

export function buildMixedQueuePreviewHeaderLine(): ShellQueuePreviewLine {
  return {
    kind: "header",
    text: "• Queued next",
    tone: "neutral",
  };
}

export function buildMixedQueuePreviewItemLine(
  kind: "chat" | "eval" | "command",
  preview: string,
): ShellQueuePreviewLine {
  return {
    kind: "item",
    text: `↳ ${kind} ${preview}`,
    tone: "muted",
  };
}

export function buildMixedQueuePreviewOverflowLine(
  hiddenCount: number,
): ShellQueuePreviewLine {
  return {
    kind: "overflow",
    text: hiddenCount === 1
      ? "+1 more queued item"
      : `+${hiddenCount} more queued items`,
    tone: "hint",
  };
}
