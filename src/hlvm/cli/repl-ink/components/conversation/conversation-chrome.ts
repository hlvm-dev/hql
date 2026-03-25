import { formatDurationMs } from "../../utils/formatting.ts";
import {
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

export function getToolDurationTone(
  durationMs: number | undefined,
): ConversationStatusTone {
  if (durationMs == null || durationMs < 1000) return "neutral";
  if (durationMs <= 5000) return "warning";
  return "error";
}

export function getThinkingLabel(kind: "reasoning" | "planning"): string {
  return kind === "reasoning" ? "Thinking" : "Planning";
}

export function splitArgKeyValue(
  line: string,
): { key: string; separator: string; value: string } | null {
  const colonIndex = line.indexOf(":");
  const equalsIndex = line.indexOf("=");
  let splitIndex = -1;
  let separator = "";

  if (colonIndex >= 0 && (equalsIndex < 0 || colonIndex <= equalsIndex)) {
    splitIndex = colonIndex;
    separator = ":";
  } else if (equalsIndex >= 0) {
    splitIndex = equalsIndex;
    separator = "=";
  }

  if (splitIndex < 1) return null;
  return {
    key: line.slice(0, splitIndex),
    separator,
    value: line.slice(splitIndex + 1),
  };
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

// ── Team Event Chrome ──────────────────────────────────────

export function getTeamTaskStatusTone(status: string): ConversationStatusTone {
  switch (status) {
    case "completed":
      return "success";
    case "errored":
      return "error";
    case "blocked":
      return "warning";
    case "in_progress":
      return "active";
    default:
      return "neutral";
  }
}

export function getTeamTaskStatusGlyph(status: string): string {
  switch (status) {
    case "completed":
      return STATUS_GLYPHS.success;
    case "errored":
      return STATUS_GLYPHS.error;
    case "blocked":
      return STATUS_GLYPHS.warning;
    case "in_progress":
      return STATUS_GLYPHS.running;
    default:
      return STATUS_GLYPHS.pending;
  }
}

export function getTeamMessageTone(kind: string): ConversationStatusTone {
  switch (kind) {
    case "task_completed":
      return "success";
    case "task_error":
      return "error";
    case "message":
    case "broadcast":
      return "active";
    default:
      return "neutral";
  }
}

export function getTeamMessageGlyph(kind: string): string {
  switch (kind) {
    case "task_completed":
      return STATUS_GLYPHS.success;
    case "task_error":
      return STATUS_GLYPHS.error;
    case "broadcast":
      return "📢";
    case "message":
      return "✉";
    default:
      return STATUS_GLYPHS.pending;
  }
}

export function getTeamShutdownTone(status: string): ConversationStatusTone {
  switch (status) {
    case "forced":
      return "error";
    case "requested":
      return "warning";
    case "acknowledged":
      return "active";
    default:
      return "neutral";
  }
}

export function getTeamShutdownGlyph(status: string): string {
  switch (status) {
    case "forced":
      return STATUS_GLYPHS.error;
    case "requested":
      return STATUS_GLYPHS.warning;
    case "acknowledged":
      return STATUS_GLYPHS.running;
    default:
      return STATUS_GLYPHS.pending;
  }
}

export function getTeamPlanReviewTone(status: string): ConversationStatusTone {
  switch (status) {
    case "approved":
      return "success";
    case "rejected":
      return "error";
    default:
      return "warning";
  }
}

export function getTeamPlanReviewGlyph(status: string): string {
  switch (status) {
    case "approved":
      return STATUS_GLYPHS.success;
    case "rejected":
      return STATUS_GLYPHS.error;
    default:
      return STATUS_GLYPHS.pending;
  }
}

