import {
  buildSectionLabelText,
} from "../../utils/display-chrome.ts";

type ConversationStatusTone =
  | "neutral"
  | "active"
  | "success"
  | "warning"
  | "error";

const DEFAULT_CONVERSATION_SECTION_LABEL_WIDTH = 24;

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

export function buildConversationSectionText(
  label: string,
  width = DEFAULT_CONVERSATION_SECTION_LABEL_WIDTH,
): string {
  return buildSectionLabelText(label, width);
}

