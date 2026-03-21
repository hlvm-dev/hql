import { truncate } from "../../../../../common/utils.ts";
import { formatDurationMs } from "../../utils/formatting.ts";
import { buildRightSlotTextLayout } from "../../utils/display-chrome.ts";

export type ConversationStatusTone =
  | "neutral"
  | "active"
  | "success"
  | "warning"
  | "error";

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
      return "✓";
    case "error":
      return "✗";
    case "cancelled":
      return "○";
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

export function buildConversationCalloutText(
  text: string,
  width: number,
): string {
  return truncate(text, Math.max(1, width), "…");
}
