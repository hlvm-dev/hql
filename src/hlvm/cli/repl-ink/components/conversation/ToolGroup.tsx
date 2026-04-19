/**
 * ToolGroup Component
 *
 * Flat list of tool calls with consistent indentation.
 * No bordered container — each tool renders independently.
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../../common/utils.ts";
import { useSemanticColors } from "../../../theme/index.ts";
import { ToolCallItem } from "./ToolCallItem.tsx";
import type { ToolCallDisplay } from "../../types.ts";
import { TRANSCRIPT_LAYOUT } from "../../utils/layout-tokens.ts";
import { resolveCollapsedToolList } from "./layout.ts";
import { resolveToolTranscriptGroupSummary } from "./tool-transcript.ts";
import { buildToolTranscriptInvocationLabel } from "./tool-transcript.ts";

interface ToolGroupProps {
  tools: ToolCallDisplay[];
  width: number;
  isToolExpanded?: (toolId: string) => boolean;
}

type CollapsedToolCategory =
  | "search"
  | "read"
  | "browser"
  | "bash"
  | "write"
  | "edit"
  | "other";

function capitalizeSummaryPart(text: string): string {
  if (!text) return text;
  return text[0]!.toUpperCase() + text.slice(1);
}

function pluralize(word: string, count: number): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function formatCountNoun(
  singular: string,
  plural: string,
  count: number,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function resolveCollapsedToolCategory(tool: ToolCallDisplay): CollapsedToolCategory {
  const kind = tool.resultMeta?.presentation?.kind;
  if (
    tool.name === "search_web" ||
    tool.name === "search_code" ||
    kind === "search"
  ) {
    return "search";
  }
  if (
    tool.name === "read_file" ||
    tool.name === "open_path" ||
    tool.name === "reveal_path" ||
    kind === "read"
  ) {
    return "read";
  }
  if (
    tool.name === "web_fetch" ||
    tool.name === "fetch_url" ||
    tool.name.startsWith("pw_") ||
    kind === "web"
  ) {
    return "browser";
  }
  if (
    tool.name === "shell_exec" ||
    tool.name === "shell_script" ||
    kind === "shell"
  ) {
    return "bash";
  }
  if (
    tool.name === "write_file" ||
    tool.name === "make_directory" ||
    tool.name === "move_path" ||
    tool.name === "copy_path" ||
    tool.name === "move_to_trash"
  ) {
    return "write";
  }
  if (
    tool.name === "edit_file" ||
    kind === "edit" ||
    kind === "diff"
  ) {
    return "edit";
  }
  return "other";
}

function formatCollapsedSummaryPart(
  category: CollapsedToolCategory,
  count: number,
  active: boolean,
  isFirst: boolean,
): string {
  switch (category) {
    case "search":
      return isFirst
        ? capitalizeSummaryPart(
          `${active ? "searching for" : "searched for"} ${
            formatCountNoun("query", "queries", count)
          }`,
        )
        : `${active ? "searching for" : "searched for"} ${
          formatCountNoun("query", "queries", count)
        }`;
    case "read":
      return isFirst
        ? capitalizeSummaryPart(`${active ? "reading" : "read"} ${pluralize("file", count)}`)
        : `${active ? "reading" : "read"} ${pluralize("file", count)}`;
    case "browser":
      return isFirst
        ? capitalizeSummaryPart(`${active ? "browsing" : "browsed"} ${pluralize("page", count)}`)
        : `${active ? "browsing" : "browsed"} ${pluralize("page", count)}`;
    case "bash":
      return isFirst
        ? capitalizeSummaryPart(`${active ? "running" : "ran"} ${pluralize("command", count)}`)
        : `${active ? "running" : "ran"} ${pluralize("command", count)}`;
    case "write":
      return isFirst
        ? capitalizeSummaryPart(`${active ? "writing" : "wrote"} ${pluralize("file", count)}`)
        : `${active ? "writing" : "wrote"} ${pluralize("file", count)}`;
    case "edit":
      return isFirst
        ? capitalizeSummaryPart(`${active ? "editing" : "edited"} ${pluralize("file", count)}`)
        : `${active ? "editing" : "edited"} ${pluralize("file", count)}`;
    case "other":
    default:
      return isFirst
        ? capitalizeSummaryPart(`${active ? "using" : "used"} ${pluralize("tool", count)}`)
        : `${active ? "using" : "used"} ${pluralize("tool", count)}`;
  }
}

function buildCollapsedOperationHint(
  tool: ToolCallDisplay | undefined,
): string | undefined {
  if (!tool) return undefined;
  const invocation = buildToolTranscriptInvocationLabel({
    name: tool.name,
    displayName: tool.displayName ?? tool.name,
    argsSummary: tool.argsSummary,
  }).trim();
  const detail = (
    tool.status === "running" ? tool.progressText :
    tool.status === "pending" ? tool.queuedText :
    tool.resultSummaryText
  )?.trim();
  if (!detail || detail === invocation) {
    return undefined;
  }
  if (invocation) {
    return `${invocation} · ${detail}`;
  }
  return detail;
}

function buildCollapsedToolSummary(
  tools: ToolCallDisplay[],
  hiddenIndexes: readonly number[],
): { summary?: string; hint?: string } {
  if (hiddenIndexes.length === 0) return {};

  const hiddenTools = hiddenIndexes
    .map((index) => tools[index])
    .filter((tool): tool is ToolCallDisplay => Boolean(tool));
  if (hiddenTools.length === 0) return {};

  const grouped = new Map<string, ToolCallDisplay[]>();
  for (const tool of hiddenTools) {
    const key = `${tool.name}:${tool.status}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(tool);
      continue;
    }
    grouped.set(key, [tool]);
  }

  const active = hiddenTools.some((tool) =>
    tool.status === "running" || tool.status === "pending"
  );
  const categoryCounts = new Map<CollapsedToolCategory, number>();
  for (const tool of hiddenTools) {
    const category = resolveCollapsedToolCategory(tool);
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }

  const categoryOrder: readonly CollapsedToolCategory[] = [
    "search",
    "read",
    "browser",
    "bash",
    "write",
    "edit",
    "other",
  ];
  const categorizedParts = categoryOrder
    .map((category) => ({
      category,
      count: categoryCounts.get(category) ?? 0,
    }))
    .filter((entry) => entry.count > 0)
    .slice(0, 3)
    .map((entry, index) =>
      formatCollapsedSummaryPart(entry.category, entry.count, active, index === 0)
    );

  const fallbackParts = Array.from(grouped.values())
    .sort((a, b) => b.length - a.length)
    .slice(0, 3)
    .map((group) =>
      resolveToolTranscriptGroupSummary(
        group[0]!.name,
        group.map((tool) => ({
          name: tool.name,
          displayName: tool.displayName,
          argsSummary: tool.argsSummary,
          status: tool.status,
          resultSummaryText: tool.resultSummaryText,
          resultDetailText: tool.resultDetailText,
          resultMeta: tool.resultMeta,
        })),
      ) ?? undefined
    )
    .filter((part): part is string => Boolean(part?.trim()))
    .map((part) => part.trim());
  const summary = categorizedParts.length > 0
    ? categorizedParts.join(", ")
    : fallbackParts.length > 0
    ? fallbackParts.join(" · ")
    : undefined;

  const hintTool = [...hiddenTools].reverse().find((tool) =>
    tool.status === "running" || tool.status === "pending"
  ) ?? hiddenTools[hiddenTools.length - 1];

  return {
    summary,
    hint: buildCollapsedOperationHint(hintTool),
  };
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
  const hasRunningShellTool = tools.some((tool) =>
    tool.status === "running" &&
    (tool.name === "shell_exec" || tool.name === "shell_script")
  );

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

    const collapsed = resolveCollapsedToolList(tools, 5);
    if (!collapsed) {
      return tools.map((tool) => (
        <Box key={tool.id}>
          <ToolCallItem
            tool={tool}
            width={innerWidth}
            expanded={false}
            animateStatusIcon={tool.id === activeRunningToolId}
          />
        </Box>
      ));
    }

    const visible = new Set(collapsed.visibleTools);
    const hiddenIndexes = tools
      .map((_, index) => index)
      .filter((index) => !visible.has(index));
    const collapsedSummary = buildCollapsedToolSummary(tools, hiddenIndexes);
    const hiddenAfterIndex = collapsed.visibleTools.find((visibleIndex, idx) =>
      idx < collapsed.visibleTools.length - 1 &&
      collapsed.visibleTools[idx + 1] - visibleIndex > 1
    );

    return tools.flatMap((tool, index) => {
      if (!visible.has(index)) return [];
      const hiddenToolLabel = collapsed.hiddenCount === 1
        ? "+1 more (ctrl+o)"
        : `+${collapsed.hiddenCount} more (ctrl+o)`;
      const collapsedHeader = collapsedSummary.summary
        ? `${hiddenToolLabel} · ${collapsedSummary.summary}`
        : hiddenToolLabel;
      const elements = [
        (
          <Box key={tool.id}>
            <ToolCallItem
              tool={tool}
              width={innerWidth}
              expanded={false}
              animateStatusIcon={tool.id === activeRunningToolId}
            />
          </Box>
        ),
      ];
      if (hiddenAfterIndex === index) {
        elements.push(
          <Box key={`collapsed-${tool.id}`} marginLeft={2}>
            <Text color={sc.text.muted}>
              {truncate(collapsedHeader, Math.max(18, innerWidth))}
            </Text>
          </Box>,
        );
        if (collapsedSummary.hint) {
          elements.push(
            <Box key={`collapsed-hint-${tool.id}`} marginLeft={2}>
              <Text color={sc.text.secondary}>
                {truncate(`⎿ ${collapsedSummary.hint}`, Math.max(18, innerWidth))}
              </Text>
            </Box>,
          );
        }
      }
      return elements;
    });
  }, [tools, isToolExpanded, activeRunningToolId, sc, innerWidth]);

  return (
    <Box
      flexDirection="column"
      paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
    >
      {toolElements}
      {hasRunningShellTool && (
        <Box marginLeft={2} marginTop={1}>
          <Text color={sc.text.muted}>(ctrl+b background)</Text>
        </Box>
      )}
    </Box>
  );
});
