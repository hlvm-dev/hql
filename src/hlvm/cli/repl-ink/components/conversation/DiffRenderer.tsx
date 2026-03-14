/**
 * DiffRenderer Component
 *
 * Renders unified diff output with syntax-colored line numbers,
 * add/del/context highlighting, and hunk headers.
 * Props-only component — no contexts except semantic colors.
 */

import React, { memo, useMemo } from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { TOGGLE_LATEST_HINT } from "../../ui-constants.ts";

// ============================================================
// Types
// ============================================================

export interface DiffLine {
  type: "add" | "del" | "context" | "hunk-header" | "file-header";
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

interface DiffRendererProps {
  content: string;
  width: number;
  maxLines?: number;
}

// ============================================================
// Parser
// ============================================================

const HUNK_HEADER_RE = /@@ -(\d+),?\d* \+(\d+),?\d* @@/;

function isDiffMetadataLine(line: string): boolean {
  return line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("copy from ") ||
    line.startsWith("copy to ") ||
    line.startsWith("Binary files ");
}

/**
 * Parse unified diff text into structured DiffLine entries.
 * Tracks old/new line counters independently per hunk.
 */
export function parseDiffLines(diffContent: string): DiffLine[] {
  const rawLines = diffContent.split("\n");
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of rawLines) {
    // New file section header (section boundary only; keep renderer concise by
    // skipping this metadata line itself).
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      oldLine = 0;
      newLine = 0;
      continue;
    }

    // Hunk header
    const hunkMatch = line.match(HUNK_HEADER_RE);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10) - 1;
      newLine = parseInt(hunkMatch[2], 10) - 1;
      inHunk = true;
      result.push({ type: "hunk-header", content: line });
      continue;
    }

    // File headers + metadata (before first hunk in a section)
    if (!inHunk && ((line.startsWith("---") || line.startsWith("+++")) || isDiffMetadataLine(line))) {
      result.push({ type: "file-header", content: line });
      continue;
    }

    // Skip diff metadata lines before first hunk (e.g. "diff --git ...")
    if (!inHunk) continue;

    // No-newline marker
    if (line.startsWith("\\")) continue;

    const prefix = line[0];
    const content = line.substring(1);

    switch (prefix) {
      case "+":
        newLine++;
        result.push({ type: "add", content, newLineNum: newLine });
        break;
      case "-":
        oldLine++;
        result.push({ type: "del", content, oldLineNum: oldLine });
        break;
      case " ":
        oldLine++;
        newLine++;
        result.push({
          type: "context",
          content,
          oldLineNum: oldLine,
          newLineNum: newLine,
        });
        break;
      default:
        // Treat unexpected lines as context (empty lines in some diffs)
        if (inHunk) {
          oldLine++;
          newLine++;
          result.push({
            type: "context",
            content: line,
            oldLineNum: oldLine,
            newLineNum: newLine,
          });
        }
        break;
    }
  }

  return result;
}

// ============================================================
// Helpers
// ============================================================

/** Check if diff is a pure addition (new file) — no del or context lines */
function isNewFile(lines: DiffLine[]): boolean {
  const contentLines = lines.filter(
    (l) => l.type !== "hunk-header" && l.type !== "file-header",
  );
  return (
    contentLines.length > 0 &&
    contentLines.every((l) => l.type === "add")
  );
}

/** Find max line number across all parsed lines */
function getMaxLineNum(lines: DiffLine[]): number {
  let max = 0;
  for (const line of lines) {
    if (line.oldLineNum && line.oldLineNum > max) max = line.oldLineNum;
    if (line.newLineNum && line.newLineNum > max) max = line.newLineNum;
  }
  return max;
}

/** Right-align a number (or blank) within a fixed width */
function padNum(num: number | undefined, width: number): string {
  if (num === undefined) return " ".repeat(width);
  return String(num).padStart(width, " ");
}

// ============================================================
// Line Renderers (pure functions returning JSX)
// ============================================================

function renderHunkHeader(
  line: DiffLine,
  key: React.Key,
  mutedColor: string,
): React.ReactElement {
  return (
    <Box key={key}>
      <Text color={mutedColor}>{line.content}</Text>
    </Box>
  );
}

function renderFileHeader(
  line: DiffLine,
  key: React.Key,
): React.ReactElement {
  return (
    <Box key={key}>
      <Text bold>{line.content}</Text>
    </Box>
  );
}

function renderGutterLine(
  line: DiffLine,
  key: React.Key,
  gutterWidth: number,
  addedColor: string,
  removedColor: string,
  mutedColor: string,
  textColor: string,
  width: number,
): React.ReactElement {
  const oldStr = padNum(line.oldLineNum, gutterWidth);
  const newStr = padNum(line.newLineNum, gutterWidth);
  const gutterTotal = gutterWidth * 2 + 6;
  const contentWidth = Math.max(1, width - gutterTotal);
  const truncatedContent =
    line.content.length > contentWidth
      ? line.content.slice(0, contentWidth - 1) + "\u2026"
      : line.content;

  let lineColor: string;
  let prefix: string;
  switch (line.type) {
    case "add":
      lineColor = addedColor;
      prefix = "+";
      break;
    case "del":
      lineColor = removedColor;
      prefix = "-";
      break;
    default:
      lineColor = textColor;
      prefix = " ";
      break;
  }

  return (
    <Box key={key}>
      <Text color={mutedColor}>
        {oldStr} \u2502 {newStr} \u2502{" "}
      </Text>
      <Text color={lineColor}>
        {prefix}
        {truncatedContent}
      </Text>
    </Box>
  );
}

function renderNewFileLine(
  line: DiffLine,
  key: React.Key,
  addedColor: string,
  width: number,
): React.ReactElement {
  const contentWidth = Math.max(1, width - 2);
  const truncatedContent =
    line.content.length > contentWidth
      ? line.content.slice(0, contentWidth - 1) + "\u2026"
      : line.content;

  return (
    <Box key={key}>
      <Text color={addedColor}>+{truncatedContent}</Text>
    </Box>
  );
}

function renderGapMarker(
  key: React.Key,
  mutedColor: string,
): React.ReactElement {
  return (
    <Box key={key}>
      <Text color={mutedColor}>  \u22EF</Text>
    </Box>
  );
}

// ============================================================
// Main Component
// ============================================================

const DiffRenderer = memo(function DiffRenderer({
  content,
  width,
  maxLines,
}: DiffRendererProps): React.ReactElement {
  const sc = useSemanticColors();
  const lines = useMemo(() => parseDiffLines(content), [content]);

  if (lines.length === 0) {
    return (
      <Box>
        <Text color={sc.text.muted}>(empty diff)</Text>
      </Box>
    );
  }

  const newFile = isNewFile(lines);
  const maxNum = getMaxLineNum(lines);
  const gutterWidth = Math.max(String(maxNum).length, 3);

  // Apply height constraint
  let visibleLines = lines;
  let truncatedCount = 0;
  if (maxLines !== undefined && lines.length > maxLines) {
    visibleLines = lines.slice(0, maxLines);
    truncatedCount = lines.length - maxLines;
  }

  const elements: React.ReactElement[] = [];
  let prevType: DiffLine["type"] | null = null;

  for (let i = 0; i < visibleLines.length; i++) {
    const line = visibleLines[i];

    // Insert gap marker between non-contiguous hunks (not the first one)
    if (line.type === "hunk-header" && prevType !== null && prevType !== "file-header") {
      elements.push(renderGapMarker(`gap-${i}`, sc.text.muted));
    }

    switch (line.type) {
      case "hunk-header":
        elements.push(renderHunkHeader(line, i, sc.text.muted));
        break;
      case "file-header":
        elements.push(renderFileHeader(line, i));
        break;
      default:
        if (newFile && line.type === "add") {
          elements.push(
            renderNewFileLine(line, i, sc.background.diff.added, width),
          );
        } else {
          elements.push(
            renderGutterLine(
              line,
              i,
              gutterWidth,
              sc.background.diff.added,
              sc.background.diff.removed,
              sc.text.muted,
              sc.text.primary,
              width,
            ),
          );
        }
        break;
    }
    prevType = line.type;
  }

  if (truncatedCount > 0) {
    elements.push(
      <Box key="truncated">
        <Text color={sc.text.muted}>
          ... ({truncatedCount} more lines · {TOGGLE_LATEST_HINT})
        </Text>
      </Box>,
    );
  }

  return <Box flexDirection="column">{elements}</Box>;
});

export default DiffRenderer;
