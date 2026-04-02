/**
 * ToolCallItem Component
 *
 * Single-line display for one tool call within a ToolGroup.
 * Layout: [StatusIcon] tool_name args_summary (duration)
 * Result shown on next line with ⎿ gutter prefix.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { ToolStatusIcon } from "./ToolStatusIcon.tsx";
import { ToolResult } from "./ToolResult.tsx";
import type { ToolCallDisplay } from "../../types.ts";
import { buildToolCallTextLayout } from "./layout.ts";
import { getToolDurationTone } from "./conversation-chrome.ts";
import { isProminentToolName } from "./turn-activity.ts";
import type { ToolPresentationKind } from "../../../../agent/registry.ts";

interface ToolCallItemProps {
  tool: ToolCallDisplay;
  width: number;
  expanded?: boolean;
  animateStatusIcon?: boolean;
}

function getPresentationBadge(
  kind: ToolPresentationKind | undefined,
): string | null {
  switch (kind) {
    case "read":
      return "READ";
    case "search":
      return "SEARCH";
    case "web":
      return "WEB";
    case "shell":
      return "SHELL";
    case "edit":
      return "EDIT";
    case "diff":
      return "DIFF";
    default:
      return null;
  }
}

export function resolveToolResultText(
  tool: Pick<
    ToolCallDisplay,
    "resultSummaryText" | "resultDetailText" | "resultText"
  >,
  expanded: boolean,
): string {
  if (expanded) {
    return tool.resultDetailText ?? tool.resultText ?? tool.resultSummaryText ??
      "";
  }
  return tool.resultSummaryText ?? tool.resultDetailText ?? tool.resultText ??
    "";
}

export const ToolCallItem = React.memo(function ToolCallItem(
  { tool, width, expanded = false, animateStatusIcon = false }:
    ToolCallItemProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const presentationKind = tool.resultMeta?.presentation?.kind;
  const presentationBadge = getPresentationBadge(presentationKind);
  const displayName = tool.displayName ?? tool.name;
  const invocationArgsSummary =
    (tool.name === "search_web" ||
      tool.name === "web_search" ||
      tool.name === "web_fetch" ||
      tool.name === "fetch_url") &&
      tool.argsSummary.trim().length > 0
      ? `("${tool.argsSummary.trim().replaceAll('"', "'")}")`
      : tool.argsSummary;
  const layout = buildToolCallTextLayout(
    Math.max(0, width - 2),
    displayName,
    invocationArgsSummary,
    tool.durationMs,
  );

  const nameColor = tool.status === "error"
    ? sc.status.error
    : isProminentToolName(tool.name)
    ? sc.text.primary
    : sc.text.secondary;
  const durationTone = getToolDurationTone(tool.durationMs);
  const durationColor = durationTone === "error"
    ? sc.status.error
    : durationTone === "warning"
    ? sc.status.warning
    : sc.text.muted;
  const resultGutterColor = tool.status === "error"
    ? sc.status.error
    : sc.text.muted;
  const progressColor = tool.progressTone === "warning"
    ? sc.status.warning
    : tool.progressTone === "success"
    ? sc.status.success
    : sc.text.secondary;
  const queuedColor = sc.text.muted;
  const shouldRenderResult = tool.status !== "running";
  const resultMaxLines = tool.status === "error"
    ? 12
    : expanded
    ? 8
    : presentationKind === "edit" || presentationKind === "diff"
    ? 2
    : 1;

  return (
    <Box flexDirection="column">
      <Box>
        <ToolStatusIcon status={tool.status} animate={animateStatusIcon} />
        <Text></Text>
        {presentationBadge && (
          <>
            <Text color={sc.chrome.sectionLabel}>{presentationBadge}</Text>
            <Text color={sc.text.muted}> </Text>
          </>
        )}
        <Text color={nameColor}>{displayName}</Text>
        {layout.argsText && (
          <Text color={sc.text.secondary}>
            {" "}
            {layout.argsText}
          </Text>
        )}
        {layout.gapWidth > 0 && <Text>{" ".repeat(layout.gapWidth)}</Text>}
        {layout.durationText && (
          <Text color={durationColor}>{layout.durationText}</Text>
        )}
      </Box>

      {tool.status === "running" && tool.progressText && (
        <Box marginLeft={2} flexDirection="row">
          <Text color={resultGutterColor}>{"⎿  "}</Text>
          <Text color={progressColor} wrap="wrap">
            {tool.progressText}
          </Text>
        </Box>
      )}

      {tool.status === "pending" && tool.queuedText && (
        <Box marginLeft={2} flexDirection="row">
          <Text color={resultGutterColor}>{"⎿  "}</Text>
          <Text color={queuedColor} wrap="wrap">
            {tool.queuedText}
          </Text>
        </Box>
      )}

      {shouldRenderResult &&
        resolveToolResultText(tool, expanded) &&
        tool.status !== "running" && (
        <Box marginLeft={2} flexDirection="row">
          <Text color={resultGutterColor}>{"⎿  "}</Text>
          <Box flexDirection="column" flexShrink={1}>
            <ToolResult
              text={resolveToolResultText(tool, expanded)}
              width={Math.max(10, width - 5)}
              maxLines={resultMaxLines}
              expanded={expanded}
              tone={tool.status === "error" ? "error" : "default"}
              meta={tool.resultMeta}
              toolName={tool.name}
              argsSummary={tool.argsSummary}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
});
