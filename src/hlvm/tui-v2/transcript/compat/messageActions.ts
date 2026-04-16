import React from "react";
import type { RenderableTranscriptMessage } from "../types.ts";

const NAVIGABLE_TYPES = [
  "user",
  "assistant",
  "grouped_tool_use",
  "collapsed_read_search",
  "system",
  "attachment",
] as const;

export type NavigableType = (typeof NAVIGABLE_TYPES)[number];
export type NavigableMessage = RenderableTranscriptMessage;

type PrimaryInput = {
  label: string;
  extract: (input: Record<string, unknown>) => string | undefined;
};

const str = (key: string) => (input: Record<string, unknown>) =>
  typeof input[key] === "string" ? input[key] as string : undefined;

const PRIMARY_INPUT: Record<string, PrimaryInput> = {
  Read: { label: "path", extract: str("file_path") },
  Edit: { label: "path", extract: str("file_path") },
  Write: { label: "path", extract: str("file_path") },
  NotebookEdit: { label: "path", extract: str("notebook_path") },
  Bash: { label: "command", extract: str("command") },
  Grep: { label: "pattern", extract: str("pattern") },
  Glob: { label: "pattern", extract: str("pattern") },
  WebFetch: { label: "url", extract: str("url") },
  WebSearch: { label: "query", extract: str("query") },
  Task: { label: "prompt", extract: str("prompt") },
  Agent: { label: "prompt", extract: str("prompt") },
  Tmux: {
    label: "command",
    extract: (input) =>
      Array.isArray(input.args) &&
        input.args.every((value) => typeof value === "string")
        ? `tmux ${input.args.join(" ")}`
        : undefined,
  },
};

export type MessageActionsState = {
  uuid: string;
  msgType: NavigableType;
  expanded: boolean;
  toolName?: string;
};

export type MessageActionsNav = {
  enterCursor: () => void;
  navigatePrev: () => void;
  navigateNext: () => void;
  navigatePrevUser: () => void;
  navigateNextUser: () => void;
  navigateTop: () => void;
  navigateBottom: () => void;
  getSelected: () => NavigableMessage | null;
};

export const MessageActionsSelectedContext = React.createContext(false);
export const InVirtualListContext = React.createContext(false);

export function useSelectedMessageBg(): string | undefined {
  return React.useContext(MessageActionsSelectedContext)
    ? "ansi:236"
    : undefined;
}

export function stripSystemReminders(text: string): string {
  const close = "</system-reminder>";
  let normalized = text.trimStart();

  while (normalized.startsWith("<system-reminder>")) {
    const end = normalized.indexOf(close);
    if (end < 0) break;
    normalized = normalized.slice(end + close.length).trimStart();
  }

  return normalized;
}

export function toolCallOf(
  msg: NavigableMessage,
): { name: string; input: Record<string, unknown> } | undefined {
  if (msg.type === "assistant" || msg.type === "grouped_tool_use") {
    return msg.toolCall;
  }

  return undefined;
}

export function primaryToolInputLabel(
  toolName: string,
): string | undefined {
  return PRIMARY_INPUT[toolName]?.label;
}

export function primaryToolInputValue(
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  return PRIMARY_INPUT[toolName]?.extract(input);
}

export function isNavigableMessage(msg: NavigableMessage): boolean {
  switch (msg.type) {
    case "assistant":
      return msg.lines.length > 0 ||
        !!(msg.toolCall && msg.toolCall.name in PRIMARY_INPUT);
    case "user":
      if (msg.isMeta || msg.isCompactSummary) return false;
      return !stripSystemReminders(msg.stickyText ?? msg.lines.join("\n"))
        .startsWith("<");
    case "system":
      switch (msg.subtype) {
        case "api_metrics":
        case "stop_hook_summary":
        case "turn_duration":
        case "memory_saved":
        case "agents_killed":
        case "away_summary":
        case "thinking":
          return false;
      }
      return true;
    case "grouped_tool_use":
    case "collapsed_read_search":
      return true;
    case "attachment":
      switch (msg.attachmentType) {
        case "queued_command":
        case "diagnostics":
        case "hook_blocking_error":
        case "hook_error_during_execution":
          return true;
        default:
          return false;
      }
  }
}
