/**
 * ToolGroup Component
 *
 * Flat list of tool calls with consistent indentation.
 * No bordered container — each tool renders independently.
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { ToolCallItem } from "./ToolCallItem.tsx";
import type { ToolCallDisplay } from "../../types.ts";
import { TRANSCRIPT_LAYOUT } from "../../utils/layout-tokens.ts";
import { resolveToolTranscriptGroupSummary } from "./tool-transcript.ts";

interface ToolGroupProps {
  tools: ToolCallDisplay[];
  width: number;
  isToolExpanded?: (toolId: string) => boolean;
}

type CollapsedToolEntry =
  | { kind: "tool"; tool: ToolCallDisplay }
  | { kind: "summary"; key: string; text: string };

function isCollapsibleSemanticKind(
  kind: string | undefined,
): kind is "read" | "search" | "web" {
  return kind === "read" || kind === "search" || kind === "web";
}

function isSemanticCollapseCandidate(tool: ToolCallDisplay): boolean {
  return tool.status === "success" &&
    isCollapsibleSemanticKind(tool.resultMeta?.presentation?.kind);
}

function extractSummaryCount(tool: ToolCallDisplay): number | undefined {
  const summary = tool.resultSummaryText ?? tool.resultDetailText ??
    tool.resultText ?? "";
  const match = /(\d+)\s+(match|result|symbol|entry|item)/i.exec(summary);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function summarizeCollapsedTools(tools: ToolCallDisplay[]): string {
  const firstToolName = tools[0]?.name;
  const sameToolName = firstToolName &&
    tools.every((tool) => tool.name === firstToolName)
    ? firstToolName
    : undefined;
  if (sameToolName) {
    const transcriptSummary = resolveToolTranscriptGroupSummary(
      sameToolName,
      tools,
    );
    if (transcriptSummary) return transcriptSummary;
  }

  const firstKind = tools[0]?.resultMeta?.presentation?.kind;
  const count = tools.length;
  const parts = [
    firstKind === "read"
      ? `Read ${count} file${count === 1 ? "" : "s"}`
      : firstKind === "search"
      ? `Searched ${count} target${count === 1 ? "" : "s"}`
      : `Worked with ${count} web source${count === 1 ? "" : "s"}`,
  ];

  if (firstKind === "web") {
    const totalResults = tools.reduce((sum, tool) =>
      sum +
        (tool.resultMeta?.webSearch?.sourceGuard?.resultCount ??
          extractSummaryCount(tool) ?? 0)
    , 0);
    if (totalResults > 0) {
      parts.push(`${totalResults} results`);
    }
  } else if (firstKind === "search") {
    const totalMatches = tools.reduce((sum, tool) =>
      sum + (extractSummaryCount(tool) ?? 0)
    , 0);
    if (totalMatches > 0) {
      parts.push(`${totalMatches} matches`);
    }
  }

  return parts.join(" · ");
}

function buildCollapsedEntries(
  tools: ToolCallDisplay[],
): CollapsedToolEntry[] {
  const items: CollapsedToolEntry[] = [];
  let index = 0;

  while (index < tools.length) {
    const tool = tools[index];
    if (!isSemanticCollapseCandidate(tool)) {
      items.push({ kind: "tool", tool });
      index += 1;
      continue;
    }

    let runEnd = index + 1;
    const runKind = tool.resultMeta?.presentation?.kind;
    while (
      runEnd < tools.length &&
      isSemanticCollapseCandidate(tools[runEnd]) &&
      tools[runEnd]?.resultMeta?.presentation?.kind === runKind
    ) {
      runEnd += 1;
    }

    const run = tools.slice(index, runEnd);
    if (run.length === 1) {
      items.push({ kind: "tool", tool });
      index = runEnd;
      continue;
    }

    const hiddenTools = run.slice(0, -1);
    items.push({
      kind: "summary",
      key: `collapsed-${hiddenTools[0]?.id ?? index}`,
      text: summarizeCollapsedTools(hiddenTools),
    });
    items.push({ kind: "tool", tool: run[run.length - 1] });
    index = runEnd;
  }

  return items;
}

export const ToolGroup = React.memo(function ToolGroup({
  tools,
  width,
  isToolExpanded,
}: ToolGroupProps): React.ReactElement {
  const sc = useSemanticColors();
  const innerWidth = Math.max(10, width - 2);
  const activeRunningToolId = tools.find((tool) => tool.status === "running")
    ?.id;

  const toolElements = useMemo(() => {
    const anyExpanded = tools.some((t) => isToolExpanded?.(t.id));
    if (anyExpanded) {
      return tools.map((tool) => (
        <Box key={tool.id}>
          <ToolCallItem
            tool={tool}
            width={innerWidth}
            expanded={Boolean(isToolExpanded?.(tool.id))}
            animateStatusIcon={tool.id === activeRunningToolId}
          />
        </Box>
      ));
    }

    return buildCollapsedEntries(tools).map((entry) =>
      entry.kind === "tool"
        ? (
          <Box key={entry.tool.id}>
            <ToolCallItem
              tool={entry.tool}
              width={innerWidth}
              expanded={false}
              animateStatusIcon={entry.tool.id === activeRunningToolId}
            />
          </Box>
        )
        : (
          <Box key={entry.key} marginLeft={2}>
            <Text color={sc.text.muted}>{entry.text}</Text>
          </Box>
        )
    );
  }, [tools, isToolExpanded, activeRunningToolId, sc, innerWidth]);

  return (
    <Box
      flexDirection="column"
      paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
    >
      {toolElements}
    </Box>
  );
});
