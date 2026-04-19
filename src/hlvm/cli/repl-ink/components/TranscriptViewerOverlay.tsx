import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { truncate } from "../../../../common/utils.ts";
import { useSemanticColors, useTheme } from "../../theme/index.ts";
import {
  resolveOverlayFrame,
  type RGB,
  themeToOverlayColors,
} from "../overlay/index.ts";
import type { HqlEvalItem, ShellHistoryEntry } from "../types.ts";
import { filterRenderableTimelineItems } from "../utils/timeline-visibility.ts";
import { OverlayBalancedRow, OverlayModal } from "./OverlayModal.tsx";
import { buildSectionLabelText } from "../utils/display-chrome.ts";

interface TranscriptViewerOverlayProps {
  historyItems: ShellHistoryEntry[];
  liveItems?: Exclude<ShellHistoryEntry, { type: "hql_eval" }>[];
  width: number;
  initialSearchActive?: boolean;
  onClose: () => void;
}

interface TranscriptOverlayLine {
  text: string;
  color: RGB;
  bold?: boolean;
}

function firstNonEmptyLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find((line) =>
    line.length > 0
  ) ?? "";
}

function capitalizeStatus(status: string): string {
  return status.length > 0
    ? status.charAt(0).toUpperCase() + status.slice(1)
    : status;
}

function summarizeEvalResult(result: HqlEvalItem["result"]): string {
  if (!result.success) {
    return result.error?.message ?? "Evaluation failed";
  }
  if (result.suppressOutput) {
    return "Output suppressed";
  }
  if (result.value == null) {
    return "OK";
  }
  const summary = firstNonEmptyLine(String(result.value));
  return summary.length > 0 ? summary : "OK";
}

function wrapOverlayText(text: string, width: number): string[] {
  if (width <= 0) return [];
  if (text.length <= width) return [text];
  if (text.trim().length === 0) return [""];

  const indent = text.match(/^\s*/)?.[0] ?? "";
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = indent;

  const pushCurrent = () => {
    if (current.trim().length > 0 || current.length > 0) {
      lines.push(current.trimEnd());
    }
    current = indent;
  };

  for (const word of words) {
    if ((current + (current.trim() ? " " : "") + word).length <= width) {
      current += current.trim().length > 0 ? ` ${word}` : word;
      continue;
    }

    if (current.trim().length > 0) {
      pushCurrent();
    }

    if (word.length <= width - indent.length) {
      current += word;
      continue;
    }

    const chunkWidth = Math.max(1, width - indent.length);
    for (let index = 0; index < word.length; index += chunkWidth) {
      lines.push(indent + word.slice(index, index + chunkWidth));
    }
    current = indent;
  }

  if (current.trim().length > 0) {
    lines.push(current.trimEnd());
  }

  return lines.length > 0 ? lines : [truncate(text, width, "…")];
}

function buildTranscriptItemLines(
  item: ShellHistoryEntry,
  expanded: boolean,
  colors: {
    accent: RGB;
    error: RGB;
    fieldText: RGB;
    meta: RGB;
    section: RGB;
    success: RGB;
    warning: RGB;
  },
): TranscriptOverlayLine[] {
  switch (item.type) {
    case "user": {
      const lines: TranscriptOverlayLine[] = [{
        text: `You · ${firstNonEmptyLine(item.text) || "(empty)"}`,
        color: colors.section,
        bold: true,
      }];
      if (expanded && item.attachments && item.attachments.length > 0) {
        lines.push({
          text: `  Attachments · ${
            item.attachments.map((entry) => entry.label).join(", ")
          }`,
          color: colors.meta,
        });
      }
      return lines;
    }
    case "assistant":
      return [{
        text: `Assistant · ${
          firstNonEmptyLine(item.text) ||
          (item.isPending ? "Pending response" : "(empty)")
        }`,
        color: colors.fieldText,
        bold: true,
      }];
    case "thinking": {
      const summaryLines = item.summary.split("\n").map((line) => line.trim())
        .filter(Boolean);
      const heading = item.kind === "planning" ? "Plan" : "Thinking";
      return [
        {
          text: `${heading} · ${summaryLines[0] ?? "Working"}`,
          color: colors.warning,
          bold: true,
        },
        ...(
          expanded
            ? summaryLines.slice(1).map((line) => ({
              text: `  ${line}`,
              color: colors.meta,
            }))
            : []
        ),
      ];
    }
    case "tool_group": {
      if (!expanded) {
        const toolSummary = item.tools.map((tool) =>
          `${tool.name} ${tool.status}`
        ).join(" · ");
        return [{
          text: `Tools · ${item.tools.length} call${
            item.tools.length === 1 ? "" : "s"
          } · ${toolSummary}`,
          color: colors.accent,
          bold: true,
        }];
      }

      const result: TranscriptOverlayLine[] = [{
        text: `Tools · ${item.tools.length} call${
          item.tools.length === 1 ? "" : "s"
        }`,
        color: colors.accent,
        bold: true,
      }];
      for (const tool of item.tools) {
        const statusColor = tool.status === "error"
          ? colors.error
          : tool.status === "success"
          ? colors.success
          : tool.status === "running"
          ? colors.warning
          : colors.meta;
        result.push({
          text: `  ${tool.name} · ${capitalizeStatus(tool.status)} · ${
            tool.argsSummary || "no args"
          }`,
          color: statusColor,
        });
        const resultSummary = firstNonEmptyLine(
          tool.resultSummaryText ?? tool.resultDetailText ?? tool.resultText ??
            "",
        );
        if (resultSummary) {
          result.push({
            text: `    ${resultSummary}`,
            color: colors.meta,
          });
        }
      }
      return result;
    }
    case "turn_stats": {
      const details = [
        `${item.toolCount} tools`,
        `${Math.max(1, Math.round(item.durationMs / 1000))}s`,
        item.modelId ? `model ${item.modelId}` : "",
      ].filter(Boolean).join(" · ");
      return [
        {
          text: `Turn ${item.status} · ${details}`,
          color: item.status === "failed"
            ? colors.error
            : item.status === "cancelled"
            ? colors.warning
            : colors.success,
          bold: true,
        },
        ...(
          expanded && item.summary
            ? [{ text: `  ${item.summary}`, color: colors.meta }]
            : []
        ),
        ...(
          expanded
            ? (item.activityTrail ?? []).slice(0, 4).map((line) => ({
              text: `  ${line}`,
              color: colors.meta,
            }))
            : []
        ),
      ];
    }
    case "memory_activity": {
      const summaryParts = [
        item.recalled > 0 ? `${item.recalled} recalled` : "",
        item.written > 0 ? `${item.written} written` : "",
        item.searched ? `${item.searched.count} searched` : "",
      ].filter(Boolean).join(" · ");
      return [
        {
          text: `Memory · ${summaryParts || "updated"}`,
          color: colors.accent,
          bold: true,
        },
        ...(
          expanded
            ? item.details.slice(0, 4).map((detail) => ({
              text: `  ${detail.action} · ${detail.text}`,
              color: colors.meta,
            }))
            : []
        ),
      ];
    }
    case "error":
      return [{
        text: `Error · ${item.text}`,
        color: colors.error,
        bold: true,
      }];
    case "info":
      return [{
        text: `Info · ${firstNonEmptyLine(item.text) || "(empty)"}`,
        color: colors.meta,
        bold: true,
      }];
    case "hql_eval": {
      const lines: TranscriptOverlayLine[] = [{
        text: `HQL · ${firstNonEmptyLine(item.input) || "(empty)"}`,
        color: colors.section,
        bold: true,
      }];
      if (expanded) {
        lines.push({
          text: `  ${summarizeEvalResult(item.result)}`,
          color: item.result.success ? colors.meta : colors.error,
        });
      }
      return lines;
    }
  }
  return [{
    text: firstNonEmptyLine("Unsupported transcript item"),
    color: colors.meta,
  }];
}

function buildTranscriptOverlayLines(
  items: readonly ShellHistoryEntry[],
  expanded: boolean,
  colors: {
    accent: RGB;
    error: RGB;
    fieldText: RGB;
    meta: RGB;
    section: RGB;
    success: RGB;
    warning: RGB;
  },
  width: number,
): TranscriptOverlayLine[] {
  const output: TranscriptOverlayLine[] = [];
  for (const item of items) {
    const entryLines = buildTranscriptItemLines(item, expanded, colors);
    if (output.length > 0) {
      output.push({ text: "", color: colors.meta });
    }
    for (const line of entryLines) {
      const wrapped = wrapOverlayText(line.text, width);
      for (const segment of wrapped) {
        output.push({
          text: segment,
          color: line.color,
          bold: line.bold,
        });
      }
    }
  }
  return output;
}

function removeLastCharacter(value: string): string {
  const chars = Array.from(value);
  chars.pop();
  return chars.join("");
}

export function TranscriptViewerOverlay(
  {
    historyItems,
    liveItems = [],
    width,
    initialSearchActive = false,
    onClose,
  }: TranscriptViewerOverlayProps,
): React.ReactElement | null {
  const { stdout } = useStdout();
  const { theme } = useTheme();
  const sc = useSemanticColors();
  const [showAll, setShowAll] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isSearching, setIsSearching] = useState(initialSearchActive);
  const [searchQuery, setSearchQuery] = useState("");
  const terminalWidth = stdout?.columns ?? 120;
  const terminalHeight = stdout?.rows ?? 24;
  const requestedWidth = Math.max(72, Math.min(width + 6, terminalWidth - 4));
  const overlayFrame = useMemo(
    () =>
      resolveOverlayFrame(requestedWidth, Math.min(terminalHeight - 2, 26), {
        minWidth: 56,
        minHeight: 14,
        viewport: { columns: terminalWidth, rows: terminalHeight },
      }),
    [requestedWidth, terminalHeight, terminalWidth],
  );
  const contentWidth = Math.max(24, overlayFrame.width - 8);
  const colors = useMemo(() => themeToOverlayColors(theme), [theme]);
  const items = useMemo(
    () => filterRenderableTimelineItems([...historyItems, ...liveItems]),
    [historyItems, liveItems],
  );
  const contentLines = useMemo(
    () =>
      buildTranscriptOverlayLines(
        items,
        showAll,
        {
          accent: colors.accent,
          error: colors.error,
          fieldText: colors.fieldText,
          meta: colors.meta,
          section: colors.section,
          success: colors.success,
          warning: colors.warning,
        },
        contentWidth,
      ),
    [
      colors.accent,
      colors.error,
      colors.fieldText,
      colors.meta,
      colors.section,
      colors.success,
      colors.warning,
      contentWidth,
      items,
      showAll,
    ],
  );
  const displayLines = useMemo(() => {
    if (!isSearching || !searchQuery.trim()) return contentLines;
    const normalizedQuery = searchQuery.toLowerCase();
    return contentLines.filter((line: TranscriptOverlayLine) =>
      line.text.toLowerCase().includes(normalizedQuery)
    );
  }, [contentLines, isSearching, searchQuery]);
  const contentStartY = overlayFrame.y + 5;
  const footerY = overlayFrame.y + overlayFrame.height - 3;
  const visibleRows = Math.max(4, footerY - contentStartY);
  const maxScrollOffset = Math.max(0, displayLines.length - visibleRows);

  useEffect(() => {
    setScrollOffset((current: number) => Math.min(current, maxScrollOffset));
  }, [maxScrollOffset]);
  useEffect(() => {
    setScrollOffset(0);
  }, [searchQuery]);

  useInput((input, key) => {
    const lowerInput = input.toLowerCase();

    // Search mode input handling
    if (isSearching) {
      if (key.escape) {
        setIsSearching(false);
        setSearchQuery("");
        return;
      }
      if (key.return) {
        setIsSearching(false);
        return;
      }
      if (key.backspace || key.delete) {
        setSearchQuery((current: string) => removeLastCharacter(current));
        return;
      }
      if (!key.ctrl && !key.meta && input.length > 0 && input !== "\r" && input !== "\n") {
        setSearchQuery((current: string) => current + input);
      }
      return;
    }

    // Normal mode
    if (
      key.escape || (key.ctrl && (lowerInput === "c" || lowerInput === "[")) ||
      lowerInput === "q"
    ) {
      onClose();
      return;
    }
    if (key.ctrl && lowerInput === "r") {
      setIsSearching(true);
      setSearchQuery("");
      return;
    }
    if (lowerInput === "/" || lowerInput === "f") {
      setIsSearching(true);
      setSearchQuery("");
      return;
    }
    if (key.ctrl && lowerInput === "e") {
      setShowAll((prev: boolean) => !prev);
      setScrollOffset(0);
      return;
    }
    if (key.upArrow) {
      setScrollOffset((current: number) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow) {
      setScrollOffset((current: number) =>
        Math.min(maxScrollOffset, current + 1)
      );
      return;
    }
    if (key.pageUp) {
      setScrollOffset((current: number) => Math.max(0, current - visibleRows));
      return;
    }
    if (key.pageDown) {
      setScrollOffset((current: number) =>
        Math.min(maxScrollOffset, current + visibleRows)
      );
    }
  });

  const headerMode = showAll ? "expanded" : "compact";
  const visibleLines = displayLines.slice(
    scrollOffset,
    scrollOffset + visibleRows,
  );
  const footerHint = isSearching
    ? "Esc cancel search · Enter close search"
    : displayLines.length > visibleRows
    ? "↑/↓ scroll · Ctrl+R search · Ctrl+E toggle"
    : "Ctrl+R search · Ctrl+E toggle detail density";

  return (
    <OverlayModal
      title="Conversation history"
      rightText="esc close"
      width={overlayFrame.width}
      minHeight={overlayFrame.height}
    >
      <Box paddingLeft={3} flexDirection="column">
        <OverlayBalancedRow
          leftText={`Entries ${items.length} · ${headerMode}`}
          rightText={showAll ? "Ctrl+E compact" : "Ctrl+E expand"}
          width={contentWidth}
          leftColor={sc.text.primary}
          rightColor={sc.text.muted}
          leftBold
        />
        {isSearching
          ? (
            <>
              <Text
                color={searchQuery ? sc.footer.status.active : sc.text.muted}
                wrap="truncate-end"
              >
                {truncate(
                  searchQuery
                    ? `Search: ${searchQuery}`
                    : "Search: type to filter",
                  contentWidth,
                  "…",
                )}
              </Text>
              <Text color={sc.text.muted} wrap="truncate-end">
                {truncate(
                  "Esc search · Enter close",
                  contentWidth,
                  "…",
                )}
              </Text>
            </>
          )
          : (
            <Text color={sc.text.muted} wrap="truncate-end">
              {items.length > 0
                ? truncate(
                  `Showing ${Math.min(displayLines.length, visibleRows)} of ${
                    displayLines.length
                  } visible transcript lines`,
                  contentWidth,
                  "…",
                )
                : "No transcript entries yet."}
            </Text>
          )}
        <Text color={sc.chrome.sectionLabel}>
          {buildSectionLabelText("Transcript", contentWidth)}
        </Text>
      </Box>

      <Box paddingLeft={3} flexDirection="column">
        {visibleLines.map((line: TranscriptOverlayLine, index: number) => (
          <Box key={`${index}:${line.text}`}>
            <Text
              color={rgbToHex(line.color)}
              bold={line.bold}
              wrap="truncate-end"
            >
              {truncate(line.text, contentWidth, "…")}
            </Text>
          </Box>
        ))}
      </Box>

      <Box paddingLeft={3} flexDirection="column">
        <Text color={sc.footer.status.active} wrap="truncate-end">
          {truncate(footerHint, contentWidth, "…")}
        </Text>
        <OverlayBalancedRow
          leftText={scrollOffset > 0 ? `${scrollOffset} lines above` : ""}
          rightText={displayLines.length > 0
            ? `${scrollOffset + 1}-${
              Math.min(displayLines.length, scrollOffset + visibleRows)
            }/${displayLines.length}`
            : "empty"}
          width={contentWidth}
          leftColor={sc.text.muted}
          rightColor={sc.footer.status.active}
        />
      </Box>
    </OverlayModal>
  );
}

function rgbToHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}
