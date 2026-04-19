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
import { buildToolTranscriptInvocationLabel } from "./tool-transcript.ts";
import { truncate } from "../../../../../common/utils.ts";

interface ToolCallItemProps {
  tool: ToolCallDisplay;
  width: number;
  expanded?: boolean;
  animateStatusIcon?: boolean;
}

function isInlineSecondaryTextAllowed(
  text: string | undefined,
  presentationKind: string | undefined,
  expanded: boolean,
): text is string {
  if (expanded || !text) return false;
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes("\n")) return false;
  if (
    presentationKind === "diff" || presentationKind === "edit"
  ) {
    return false;
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return false;
  }
  return true;
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
  const displayName = tool.displayName ?? tool.name;
  const invocationLabel = buildToolTranscriptInvocationLabel({
    name: tool.name,
    displayName,
    argsSummary: tool.argsSummary,
  });
  const resultText = resolveToolResultText(tool, expanded);
  const inlineSummary = tool.status === "running"
    ? isInlineSecondaryTextAllowed(tool.progressText, presentationKind, expanded)
      ? tool.progressText.trim()
      : undefined
    : tool.status === "pending"
    ? isInlineSecondaryTextAllowed(tool.queuedText, presentationKind, expanded)
      ? tool.queuedText.trim()
      : undefined
    : isInlineSecondaryTextAllowed(resultText, presentationKind, expanded)
    ? resultText.trim()
    : undefined;
  const layout = buildToolCallTextLayout(
    Math.max(0, width - 2),
    invocationLabel,
    tool.durationMs,
    inlineSummary,
  );

  const labelColor = tool.status === "error"
    ? sc.status.error
    : presentationKind === "shell" || isProminentToolName(tool.name)
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
  const inlineSummaryColor = tool.status === "error"
    ? sc.status.error
    : tool.status === "running"
    ? progressColor
    : tool.status === "pending"
    ? sc.text.muted
    : sc.text.secondary;
  const showInlineSummary = Boolean(layout.suffixText);
  const shouldRenderResult = tool.status !== "running";
  const resultMaxLines = tool.status === "error"
    ? 12
    : expanded
    ? 8
    : presentationKind === "edit" || presentationKind === "diff"
    ? 2
    : 1;
  const detailTextWidth = Math.max(12, width - 5);
  const runningProgressText = tool.progressText?.trim()
    ? truncate(tool.progressText.trim(), detailTextWidth)
    : undefined;
  const queuedText = tool.queuedText?.trim()
    ? truncate(tool.queuedText.trim(), detailTextWidth)
    : undefined;

  return (
    <Box flexDirection="column">
      <Box>
        <ToolStatusIcon status={tool.status} animate={animateStatusIcon} />
        <Text> </Text>
        <Text color={labelColor} bold wrap="truncate-end">
          {layout.labelText}
        </Text>
        {layout.gapWidth > 0 && <Text>{" ".repeat(layout.gapWidth)}</Text>}
        {layout.durationText && (
          <Text color={durationColor}>{layout.durationText}</Text>
        )}
        {showInlineSummary && (
          <Text color={inlineSummaryColor} wrap="truncate-end">
            {layout.suffixText}
          </Text>
        )}
      </Box>

      {tool.status === "running" && runningProgressText && !showInlineSummary && (
        <Box marginLeft={2} flexDirection="row">
          <Text color={resultGutterColor}>{"⎿  "}</Text>
          <Text color={progressColor} wrap="truncate-end">
            {runningProgressText}
          </Text>
        </Box>
      )}

      {tool.status === "pending" && queuedText && !showInlineSummary && (
        <Box marginLeft={2} flexDirection="row">
          <Text color={resultGutterColor}>{"⎿  "}</Text>
          <Text color={queuedColor} wrap="truncate-end">
            {queuedText}
          </Text>
        </Box>
      )}

      {shouldRenderResult &&
        resultText &&
        !showInlineSummary &&
        tool.status !== "running" && (
        <Box marginLeft={2} flexDirection="row">
          <Text color={resultGutterColor}>{"⎿  "}</Text>
          <Box flexDirection="column" flexShrink={1}>
            <ToolResult
              text={resultText}
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
