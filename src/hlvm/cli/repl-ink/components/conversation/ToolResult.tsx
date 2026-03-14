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
import { truncateLine } from "../../utils/formatting.ts";

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
  let hasOld = false;
  let hasNew = false;
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    // Check prefixes without allocating substrings for every line
    const ch = text[start];
    if (ch === "d" && text.startsWith("diff --git ", start)) return true;
    if (ch === "@" && text.startsWith("@@ ", start)) return true;
    if (ch === "-" && text.startsWith("--- ", start)) hasOld = true;
    if (ch === "+" && text.startsWith("+++ ", start)) hasNew = true;
    if (hasOld && hasNew) return true;
    start = end + 1;
  }
  return false;
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
