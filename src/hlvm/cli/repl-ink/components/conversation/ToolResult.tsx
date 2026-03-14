/**
 * ToolResult Component
 *
 * Renders tool result text with content-type detection.
 * Routes to specialized renderers: DiffRenderer for diffs, JSON formatting, plain text.
 * Truncates to maxLines with a "more lines" indicator.
 */

import React, { memo } from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import DiffRenderer from "./DiffRenderer.tsx";
import { TOGGLE_LATEST_HINT } from "../../ui-constants.ts";
import { escapeAnsiCtrlCodes } from "../../utils/sanitize-ansi.ts";

const MAX_RESULT_CHARS = 20_000;

interface ToolResultProps {
  text: string;
  width: number;
  maxLines?: number;
  expanded?: boolean;
  tone?: "default" | "error";
}

type ContentType = "diff" | "json" | "plain";

function isUnifiedDiffLike(text: string): boolean {
  const lines = text.split("\n");
  const hasGitHeader = lines.some((line: string) => line.startsWith("diff --git "));
  const hasHunkHeader = lines.some((line: string) => line.startsWith("@@ "));
  const hasOldFileHeader = lines.some((line: string) => line.startsWith("--- "));
  const hasNewFileHeader = lines.some((line: string) => line.startsWith("+++ "));

  if (hasGitHeader || hasHunkHeader) return true;
  return hasOldFileHeader && hasNewFileHeader;
}

/** Detect content type from the text */
export function detectContentType(text: string): ContentType {
  const trimmed = text.trim();
  // Unified diff format (avoid false positives for plain text starting with '---')
  if (isUnifiedDiffLike(trimmed)) {
    return "diff";
  }
  // JSON object or array (only when parse succeeds)
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      return "plain";
    }
  }
  return "plain";
}

/** Try to pretty-print JSON; return null on failure */
export function tryFormatJson(text: string): string | null {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

/** Truncate a single line to fit width */
function truncateLine(line: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (line.length <= maxLen) return line;
  return maxLen > 3 ? line.slice(0, maxLen - 1) + "…" : line.slice(0, maxLen);
}

export const ToolResult = memo(function ToolResult({
  text,
  width,
  maxLines = 10,
  expanded = false,
  tone = "default",
}: ToolResultProps): React.ReactElement {
  const sc = useSemanticColors();
  const sanitized = escapeAnsiCtrlCodes(text);
  const safeTruncated = sanitized.length > MAX_RESULT_CHARS
    ? "..." + sanitized.slice(-MAX_RESULT_CHARS)
    : sanitized;
  const contentType = detectContentType(safeTruncated);

  // Route to DiffRenderer for diff content
  if (contentType === "diff") {
    return <DiffRenderer content={safeTruncated} width={width} maxLines={expanded ? undefined : maxLines} />;
  }

  // For JSON, try to format; fall back to raw text
  const displayText = contentType === "json" ? (tryFormatJson(safeTruncated) ?? safeTruncated) : safeTruncated;

  const allLines = displayText.split("\n");
  const effectiveMaxLines = expanded ? Number.MAX_SAFE_INTEGER : maxLines;
  const truncated = allLines.length > effectiveMaxLines;
  const visibleLines = truncated ? allLines.slice(0, effectiveMaxLines) : allLines;
  const remaining = allLines.length - visibleLines.length;

  return (
    <Box flexDirection="column">
      {visibleLines.map((line, i) => (
        <Box key={i}>
          <Text
            color={tone === "error"
              ? sc.status.error
              : contentType === "json"
              ? sc.status.success
              : sc.text.secondary}
          >
            {truncateLine(line, width)}
          </Text>
        </Box>
      ))}

      {truncated && (
        <Text color={tone === "error" ? sc.status.error : sc.text.muted}>
          … ({remaining} more lines · {TOGGLE_LATEST_HINT})
        </Text>
      )}
    </Box>
  );
});
