import type {
  ConversationAttachmentRef,
  ConversationItem,
  EvalResult,
  ToolCallDisplay,
} from "../../cli/repl-ink/types.ts";
import {
  buildToolTranscriptInvocationLabel,
} from "../../cli/repl-ink/components/conversation/tool-transcript.ts";
import type { RenderableTranscriptMessage } from "./types.ts";

function compactLines(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0 || seen.has(line)) continue;
    seen.add(line);
    result.push(line);
  }

  return result;
}

function formatDuration(durationMs: number | undefined): string | undefined {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return undefined;
  }

  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
  }

  return `${Math.max(0, Math.round(durationMs))}ms`;
}

function summarizeAttachments(
  attachments: readonly ConversationAttachmentRef[] | undefined,
): string[] {
  if (!attachments || attachments.length === 0) return [];
  return attachments.map((attachment) =>
    attachment.attachmentId
      ? `${attachment.label} (${attachment.attachmentId})`
      : attachment.label
  );
}

function formatEvalResult(result: EvalResult): string[] {
  if (!result.success) {
    return compactLines([
      result.error?.message ?? "evaluation failed",
      ...(result.logs ?? []),
    ]);
  }

  if (result.suppressOutput) {
    return compactLines(result.logs ?? []);
  }

  const output = result.isCommandOutput
    ? String(result.value ?? "")
    : result.value === undefined
    ? "undefined"
    : typeof result.value === "string"
    ? result.value
    : JSON.stringify(result.value, null, 2);

  return compactLines([output, ...(result.logs ?? [])]);
}

function toolLines(tools: readonly ToolCallDisplay[]): string[] {
  return compactLines(tools.flatMap((tool) => {
    const statusLabel = tool.status === "running"
      ? "running"
      : tool.status === "pending"
      ? "queued"
      : tool.status;
    const duration = formatDuration(tool.durationMs);

    return [
      tool.queuedText,
      tool.progressText,
      tool.resultSummaryText,
      tool.resultDetailText,
      tool.resultText,
      duration ? `${statusLabel} · ${duration}` : statusLabel,
    ].filter((value): value is string => typeof value === "string");
  }));
}

function renderToolGroup(
  item: Extract<ConversationItem, { type: "tool_group" }>,
): RenderableTranscriptMessage {
  const primary = item.tools[0];
  const fallbackTitle = primary
    ? buildToolTranscriptInvocationLabel({
      name: primary.name,
      displayName: primary.displayName,
      argsSummary: primary.argsSummary,
    })
    : "Tool call";

  const title = item.tools.length <= 1
    ? fallbackTitle
    : `${fallbackTitle} +${item.tools.length - 1}`;

  return {
    uuid: item.id,
    type: "grouped_tool_use",
    title,
    lines: toolLines(item.tools),
    stickyText: primary?.resultSummaryText ?? primary?.argsSummary ?? null,
    searchText: item.tools.map((tool) =>
      [
        tool.displayName ?? tool.name,
        tool.argsSummary,
        tool.progressText,
        tool.resultSummaryText,
        tool.resultDetailText,
        tool.resultText,
      ].filter(Boolean).join("\n")
    ).join("\n\n"),
    toolName: primary?.displayName ?? primary?.name ?? "tool",
  };
}

function renderSystem(
  id: string,
  title: string,
  lines: string[],
  subtype?: string,
): RenderableTranscriptMessage {
  return {
    uuid: id,
    type: "system",
    title,
    lines: compactLines(lines),
    subtype,
  };
}

function renderConversationItem(
  item: ConversationItem,
): RenderableTranscriptMessage | null {
  switch (item.type) {
    case "user":
      return {
        uuid: item.id,
        type: "user",
        title: "Prompt",
        lines: compactLines([
          item.text,
          ...summarizeAttachments(item.attachments),
        ]),
        stickyText: item.submittedText ?? item.text,
      };
    case "assistant":
      if (item.isPending && item.text.trim().length === 0) {
        return null;
      }
      return {
        uuid: item.id,
        type: "assistant",
        title: item.text,
        lines: [],
        stickyText: item.text,
      };
    case "thinking": {
      const thinkingText = item.summary || `iteration ${item.iteration}`;
      return {
        uuid: item.id,
        type: "thinking",
        title: item.kind === "planning" ? "Planning" : "Thinking",
        lines: [],
        thinking: thinkingText,
        kind: item.kind === "planning" ? "planning" : "thinking",
      };
    }
    case "tool_group":
      return renderToolGroup(item);
    case "turn_stats":
      return null;
    case "error":
      return renderSystem(item.id, "Error", [item.text], "error");
    case "info":
      return renderSystem(
        item.id,
        item.isTransient ? "Info" : "Notice",
        [item.text],
        item.isTransient ? "transient" : "info",
      );
    case "memory_activity":
      return {
        uuid: item.id,
        type: "collapsed_read_search",
        title: "Memory activity",
        lines: compactLines([
          `${item.recalled} recalled · ${item.written} written`,
          item.searched
            ? `searched: ${item.searched.query} (${item.searched.count})`
            : "",
          ...item.details.map((detail) => detail.text),
        ]),
        relevantMemories: item.details.map((detail) => ({
          content: detail.text,
        })),
      };
    case "hql_eval":
      return renderSystem(
        item.id,
        "HQL evaluation",
        compactLines([item.input, ...formatEvalResult(item.result)]),
        "eval",
      );
  }
}

export function adaptConversationItems(
  items: readonly ConversationItem[],
): RenderableTranscriptMessage[] {
  return items.flatMap((item) => {
    const rendered = renderConversationItem(item);
    return rendered ? [rendered] : [];
  });
}
