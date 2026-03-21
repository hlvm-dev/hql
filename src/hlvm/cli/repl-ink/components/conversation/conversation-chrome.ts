import { formatDurationMs } from "../../utils/formatting.ts";
import {
  buildBalancedTextRow,
  buildRightSlotTextLayout,
  buildSectionLabelText,
} from "../../utils/display-chrome.ts";
import { STATUS_GLYPHS } from "../../ui-constants.ts";

export type ConversationStatusTone =
  | "neutral"
  | "active"
  | "success"
  | "warning"
  | "error";

export const DEFAULT_CONVERSATION_SECTION_LABEL_WIDTH = 24;

export function getDelegateStatusTone(status: string): ConversationStatusTone {
  switch (status) {
    case "success":
      return "success";
    case "error":
      return "error";
    case "cancelled":
    case "queued":
      return "neutral";
    default:
      return "warning";
  }
}

export function getDelegateStatusGlyph(status: string): string {
  switch (status) {
    case "success":
      return STATUS_GLYPHS.success;
    case "error":
      return STATUS_GLYPHS.error;
    case "cancelled":
      return STATUS_GLYPHS.pending;
    case "queued":
      return "⏳";
    default:
      return "↗";
  }
}

export function getDelegateStatusLabel(status: string): string {
  switch (status) {
    case "success":
      return "done";
    case "error":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "queued":
      return "queued";
    default:
      return status;
  }
}

export function getToolResultTone(status: string): ConversationStatusTone {
  switch (status) {
    case "error":
      return "error";
    case "success":
      return "success";
    default:
      return "neutral";
  }
}

export function getToolResultLabel(status: string): string {
  return status === "error" ? "Error output" : "Result";
}

export function getThinkingLabel(kind: "reasoning" | "planning"): string {
  return kind === "reasoning" ? "Thinking" : "Planning";
}

export function buildDelegateHeaderText(
  {
    nickname,
    agent,
    durationMs,
    status,
  }: {
    nickname?: string;
    agent: string;
    durationMs?: number;
    status: string;
  },
  width: number,
): { leftText: string; rightText: string; gapWidth: number } {
  const header = nickname ? `${nickname} [${agent}]` : `Delegate ${agent}`;
  const rightParts = [getDelegateStatusLabel(status)];
  if (durationMs != null) {
    rightParts.push(formatDurationMs(durationMs));
  }
  return buildRightSlotTextLayout(
    width,
    header,
    rightParts.join(" · "),
    Math.max(10, Math.floor(width * 0.38)),
  );
}

export function buildConversationSectionText(
  label: string,
  width = DEFAULT_CONVERSATION_SECTION_LABEL_WIDTH,
): string {
  return buildSectionLabelText(label, width);
}

export function buildWorkingIndicatorLayout(
  width: number,
  elapsedText: string,
): { leftText: string; rightText: string; gapWidth: number } {
  return buildBalancedTextRow(
    width,
    "Waiting for first token",
    `${elapsedText} · Esc interrupt`,
    {
      maxRightWidth: Math.max(14, Math.floor(width * 0.45)),
    },
  );
}
