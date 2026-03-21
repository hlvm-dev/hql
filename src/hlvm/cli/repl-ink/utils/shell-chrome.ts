import { truncate } from "../../../../common/utils.ts";

export const SHELL_PROMPT_LABELS = ["hlvm>", "answer>"] as const;
export const SHELL_SEGMENT_SEPARATOR = " · ";

const QUEUE_PREVIEW_INDEX_WIDTH = 2;

export type ShellFooterSegmentTone = "neutral" | "active" | "warning" | "muted";

export interface ShellFooterSegment {
  text: string;
  tone: ShellFooterSegmentTone;
  chip?: boolean;
}

export interface ShellQueuePreviewLine {
  kind: "header" | "item" | "ellipsis" | "hint";
  text: string;
  tone: "neutral" | "muted" | "hint";
  chip?: boolean;
}

export function getShellPromptSlotWidth(promptLabel = ""): number {
  return promptLabel.length;
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

export function joinShellText(
  parts: Array<string | undefined | null | false>,
): string {
  return parts.filter((part): part is string => Boolean(part && part.trim()))
    .join(SHELL_SEGMENT_SEPARATOR);
}

export function formatShellFooterText(segments: ShellFooterSegment[]): string {
  return joinShellText(segments.map((segment) => segment.text));
}

export function measureShellFooterSegments(
  segments: ShellFooterSegment[],
): number {
  return segments.reduce((total, segment, index) => {
    const separatorWidth = index > 0 ? SHELL_SEGMENT_SEPARATOR.length : 0;
    const chipPadding = segment.chip ? 2 : 0;
    return total + separatorWidth + segment.text.length + chipPadding;
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
    const targetIndex = [...fitted].reverse().findIndex((segment) =>
      !segment.chip
    );
    if (targetIndex === -1) {
      fitted.pop();
      continue;
    }

    const actualIndex = fitted.length - 1 - targetIndex;
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

export function buildQueuePreviewHeaderLine(): ShellQueuePreviewLine {
  return {
    kind: "header",
    text: "Queued",
    tone: "neutral",
    chip: true,
  };
}

export function buildQueuePreviewItemLine(
  index: number,
  preview: string,
): ShellQueuePreviewLine {
  return {
    kind: "item",
    text: `${
      String(index + 1).padStart(QUEUE_PREVIEW_INDEX_WIDTH, " ")
    }. ${preview}`,
    tone: "muted",
  };
}

export function buildQueuePreviewOverflowLine(): ShellQueuePreviewLine {
  return {
    kind: "ellipsis",
    text: "…",
    tone: "hint",
  };
}

export function buildQueuePreviewHintLine(
  editBindingLabel: string,
): ShellQueuePreviewLine {
  return {
    kind: "hint",
    text: `${editBindingLabel} edit last queued message`,
    tone: "hint",
  };
}
