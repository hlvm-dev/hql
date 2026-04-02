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
import { parsePatch } from "diff";

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
// Parser (uses `diff` library for hunk parsing)
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
 *
 * Uses `diff` library's `parsePatch` for reliable hunk parsing (line counting,
 * add/del/context classification) while preserving raw file headers and metadata
 * lines for the renderer.
 */
export function parseDiffLines(diffContent: string): DiffLine[] {
  if (!diffContent.trim()) return [];

  const result: DiffLine[] = [];

  // Split raw input into per-file sections to preserve headers/metadata that
  // parsePatch strips. Each section starts with "diff --git".
  const rawLines = diffContent.split("\n");

  // Group raw lines into file sections (split at "diff --git")
  const fileSections: string[][] = [];
  let currentSection: string[] = [];
  for (const line of rawLines) {
    if (line.startsWith("diff --git ")) {
      if (currentSection.length > 0) fileSections.push(currentSection);
      currentSection = [line];
    } else {
      currentSection.push(line);
    }
  }
  if (currentSection.length > 0) fileSections.push(currentSection);

  // Parse structured hunks via `diff` library
  const patches = parsePatch(diffContent);

  for (let patchIdx = 0; patchIdx < patches.length; patchIdx++) {
    const patch = patches[patchIdx];
    const section = fileSections[patchIdx];

    // Emit file-header lines from the raw section (everything before first hunk)
    if (section) {
      let inHunk = false;
      for (const line of section) {
        if (HUNK_HEADER_RE.test(line)) {
          inHunk = true;
          break;
        }
        if (!inHunk && (
          line.startsWith("diff --git ") ||
          line.startsWith("---") ||
          line.startsWith("+++") ||
          isDiffMetadataLine(line)
        )) {
          result.push({ type: "file-header", content: line });
        }
      }
    }

    // Emit hunks using parsePatch's structured data
    for (const hunk of patch.hunks) {
      result.push({
        type: "hunk-header",
        content: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      });

      let oldLine = hunk.oldStart - 1;
      let newLine = hunk.newStart - 1;

      for (const line of hunk.lines) {
        // Skip no-newline markers
        if (line.startsWith("\\")) continue;

        const prefix = line[0];
        const content = line.substring(1);

        if (prefix === "+") {
          newLine++;
          result.push({ type: "add", content, newLineNum: newLine });
        } else if (prefix === "-") {
          oldLine++;
          result.push({ type: "del", content, oldLineNum: oldLine });
        } else {
          oldLine++;
          newLine++;
          result.push({ type: "context", content, oldLineNum: oldLine, newLineNum: newLine });
        }
      }
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
  addedColor: string,
  removedColor: string,
  mutedColor: string,
): React.ReactElement {
  if (line.content.startsWith("diff --git ")) {
    const match = line.content.match(/^diff --git a\/(.+?) b\/(.+)$/);
    const label = match?.[2] ?? match?.[1] ?? line.content;
    return (
      <Box key={key}>
        <Text bold color={mutedColor}>{`File ${label}`}</Text>
      </Box>
    );
  }
  if (line.content.startsWith("+++ ")) {
    return (
      <Box key={key}>
        <Text color={addedColor}>{line.content}</Text>
      </Box>
    );
  }
  if (line.content.startsWith("--- ")) {
    return (
      <Box key={key}>
        <Text color={removedColor}>{line.content}</Text>
      </Box>
    );
  }
  return (
    <Box key={key}>
      <Text bold color={mutedColor}>{line.content}</Text>
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
  const truncatedContent = line.content.length > contentWidth
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
  const truncatedContent = line.content.length > contentWidth
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
      <Text color={mutedColor}>\u22EF</Text>
    </Box>
  );
}

function summarizeDiff(
  lines: DiffLine[],
): { fileCount: number; additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  const files = new Set<string>();

  for (const line of lines) {
    if (line.type === "add") additions++;
    if (line.type === "del") deletions++;
    if (!line.content.startsWith("diff --git ")) continue;
    const match = line.content.match(/^diff --git a\/(.+?) b\/(.+)$/);
    const label = match?.[2] ?? match?.[1];
    if (label) files.add(label);
  }

  return {
    fileCount: files.size,
    additions,
    deletions,
  };
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
  const summary = summarizeDiff(lines);

  // Apply height constraint
  let visibleLines = lines;
  let truncatedCount = 0;
  if (maxLines !== undefined && lines.length > maxLines) {
    visibleLines = lines.slice(0, maxLines);
    truncatedCount = lines.length - maxLines;
  }

  const elements: React.ReactElement[] = [];
  let prevType: DiffLine["type"] | null = null;

  if (summary.fileCount > 0 || summary.additions > 0 || summary.deletions > 0) {
    const changeLabel = summary.fileCount > 0
      ? summary.fileCount === 1
        ? "1 file changed"
        : `${summary.fileCount} files changed`
      : "Changes";
    elements.push(
      <Box key="summary">
        <Text color={sc.text.muted}>{changeLabel}</Text>
        <Text color={sc.text.muted}>{"· "}</Text>
        <Text color={sc.background.diff.added}>{`+${summary.additions}`}</Text>
        <Text color={sc.text.muted}>{" "}</Text>
        <Text color={sc.background.diff.removed}>
          {`-${summary.deletions}`}
        </Text>
      </Box>,
    );
  }

  for (let i = 0; i < visibleLines.length; i++) {
    const line = visibleLines[i];

    // Insert gap marker between non-contiguous hunks (not the first one)
    if (
      line.type === "hunk-header" && prevType !== null &&
      prevType !== "file-header"
    ) {
      elements.push(renderGapMarker(`gap-${i}`, sc.text.muted));
    }

    switch (line.type) {
      case "hunk-header":
        elements.push(renderHunkHeader(line, i, sc.text.muted));
        break;
      case "file-header":
        elements.push(
          renderFileHeader(
            line,
            i,
            sc.background.diff.added,
            sc.background.diff.removed,
            sc.text.muted,
          ),
        );
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
