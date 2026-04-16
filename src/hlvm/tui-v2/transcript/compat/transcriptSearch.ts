import type { RenderableTranscriptMessage } from "../types.ts";
import { stripSystemReminders, toolCallOf } from "./messageActions.ts";

const searchTextCache = new WeakMap<RenderableTranscriptMessage, string>();

export function renderableSearchText(msg: RenderableTranscriptMessage): string {
  const cached = searchTextCache.get(msg);
  if (cached !== undefined) return cached;

  const result = computeSearchText(msg).toLowerCase();
  searchTextCache.set(msg, result);
  return result;
}

function computeSearchText(msg: RenderableTranscriptMessage): string {
  if (typeof msg.searchText === "string") {
    return msg.searchText;
  }

  switch (msg.type) {
    case "user":
      return stripSystemReminders(msg.lines.join("\n"));
    case "assistant": {
      const toolCall = toolCallOf(msg);
      const toolText = toolCall ? JSON.stringify(toolCall.input) : "";
      return [msg.title, ...msg.lines, toolText].filter(Boolean).join("\n");
    }
    case "grouped_tool_use":
      return [msg.title, ...msg.lines].join("\n");
    case "collapsed_read_search":
      return [
        msg.title,
        ...msg.lines,
        ...(msg.relevantMemories?.map((memory) => memory.content) ?? []),
      ].join("\n");
    case "system":
      return [msg.title, ...msg.lines, msg.subtype ?? ""].filter(Boolean).join(
        "\n",
      );
    case "attachment":
      return [
        msg.title,
        ...msg.lines,
        msg.attachmentPrompt ?? "",
      ].filter(Boolean).join("\n");
  }
}
