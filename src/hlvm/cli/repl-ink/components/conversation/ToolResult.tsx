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
import { truncateTranscriptBlock } from "../../utils/transcript-truncation.ts";
import type { ToolEventMeta } from "../../../../agent/orchestrator.ts";
import type { ToolPresentationKind } from "../../../../agent/registry.ts";

import { pluralize } from "../../../../agent/tool-result-summary.ts";

const MAX_RESULT_CHARS = 20_000;

interface ToolResultProps {
  text: string;
  width: number;
  maxLines?: number;
  expanded?: boolean;
  tone?: "default" | "error";
  meta?: ToolEventMeta;
  toolName?: string;
  argsSummary?: string;
}

type ContentType = "diff" | "json" | "plain";
type StructuredTone =
  | "default"
  | "accent"
  | "muted"
  | "success"
  | "warning"
  | "error";

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
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
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

function extractSummaryCount(text: string): number | undefined {
  const match = /(\d+)\s+(match|result|symbol|entry|item|file|query)/i.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}



function isUrlLike(line: string): boolean {
  return /^https?:\/\//i.test(line.trim());
}

function resolveStructuredToneColor(
  sc: ReturnType<typeof useSemanticColors>,
  tone: "default" | "error",
  lineTone: StructuredTone,
  contentType: ContentType,
): string {
  if (tone === "error") return sc.status.error;
  switch (lineTone) {
    case "accent":
      return sc.chrome.sectionLabel;
    case "muted":
      return sc.text.muted;
    case "success":
      return sc.status.success;
    case "warning":
      return sc.status.warning;
    case "error":
      return sc.status.error;
    case "default":
    default:
      return contentType === "json" ? sc.status.success : sc.text.secondary;
  }
}

function buildKindHeader(
  kind: ToolPresentationKind | undefined,
  meta: ToolEventMeta | undefined,
  argsSummary: string | undefined,
  displayText: string,
): string | undefined {
  const target = argsSummary?.trim();
  switch (kind) {
    case "read":
      return target ? `Preview · ${target}` : "Preview";
    case "search": {
      const count = extractSummaryCount(displayText);
      return count !== undefined
        ? `${count} ${pluralize("match", count)}`
        : (target ? `Search · ${target}` : "Search Results");
    }
    case "web": {
      const parts: string[] = [];
      const resultCount = meta?.webSearch?.sourceGuard?.resultCount;
      const fetchedEvidenceCount = meta?.webSearch?.sourceGuard?.fetchedEvidenceCount;
      if (typeof resultCount === "number" && resultCount > 0) {
        parts.push(`${resultCount} ${pluralize("result", resultCount)}`);
      }
      if (typeof fetchedEvidenceCount === "number" && fetchedEvidenceCount > 0) {
        parts.push(`${fetchedEvidenceCount} fetched`);
      }
      if (target) {
        parts.push(target);
      }
      return parts.join(" · ") || "Web Results";
    }
    case "shell":
      return target ? `Command · ${target}` : "Command Output";
    case "edit":
      return target ? `Changes · ${target}` : "Change Summary";
    case "meta":
      return target ? `Details · ${target}` : "Details";
    default:
      return undefined;
  }
}

function computeVisibleLines(
  displayText: string,
  expanded: boolean,
  maxLines: number,
): {
  visibleLines: string[];
  truncated: boolean;
  remaining: number;
} {
  const allLines = displayText.split("\n");
  const effectiveMaxLines = expanded ? Number.MAX_SAFE_INTEGER : maxLines;
  const truncated = allLines.length > effectiveMaxLines;
  const visibleLines = truncated
    ? allLines.slice(0, effectiveMaxLines)
    : allLines;
  return {
    visibleLines,
    truncated,
    remaining: allLines.length - visibleLines.length,
  };
}

type CompactShellLineTone = "default" | "error" | "muted";

function buildCompactShellResult(
  displayText: string,
  maxLines: number,
): {
  visibleLines: Array<{ text: string; tone: CompactShellLineTone }>;
  truncated: boolean;
  remaining: number;
} {
  let activeSection: "stdout" | "stderr" | null = null;
  let exitLine: string | undefined;
  const bodyLines: Array<{ text: string; tone: CompactShellLineTone }> = [];
  for (const rawLine of displayText.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^exit\s+\d+/i.test(trimmed)) {
      exitLine = trimmed;
      continue;
    }
    if (trimmed === "stdout:") {
      activeSection = "stdout";
      continue;
    }
    if (trimmed === "stderr:") {
      activeSection = "stderr";
      continue;
    }
    bodyLines.push({
      text: rawLine,
      tone: activeSection === "stderr" ? "error" : "default",
    });
  }

  if (bodyLines.length === 0) {
    if (exitLine === "exit 0") {
      return {
        visibleLines: [{ text: "Done", tone: "muted" }],
        truncated: false,
        remaining: 0,
      };
    }
    return {
      visibleLines: [{
        text: exitLine ?? "(No output)",
        tone: exitLine ? "error" : "muted",
      }],
      truncated: false,
      remaining: 0,
    };
  }

  const visibleLines = bodyLines.slice(-maxLines);
  return {
    visibleLines,
    truncated: bodyLines.length > visibleLines.length,
    remaining: bodyLines.length - visibleLines.length,
  };
}

function renderStructuredLines(
  lines: string[],
  width: number,
  colorForLine: (line: string) => string,
): React.ReactElement[] {
  return lines.map((line, i) => (
    <Box key={i}>
      <Text color={colorForLine(line)}>
        {truncateLine(line, width)}
      </Text>
    </Box>
  ));
}

export const ToolResult = memo(function ToolResult({
  text,
  width,
  maxLines = 10,
  expanded = false,
  tone = "default",
  meta,
  toolName,
  argsSummary,
}: ToolResultProps): React.ReactElement {
  const sc = useSemanticColors();
  const sanitized = escapeAnsiCtrlCodes(text);
  const safeTruncated = truncateTranscriptBlock(sanitized, MAX_RESULT_CHARS);
  const contentType = detectContentType(safeTruncated);
  const presentationKind = meta?.presentation?.kind;

  // Route to DiffRenderer for diff content
  if (contentType === "diff" || presentationKind === "diff") {
    return (
      <DiffRenderer
        content={safeTruncated}
        width={width}
        maxLines={expanded ? undefined : maxLines}
      />
    );
  }

  // For JSON, try to format; fall back to raw text
  const displayText = contentType === "json"
    ? (tryFormatJson(safeTruncated) ?? safeTruncated)
    : safeTruncated;

  const { visibleLines, truncated, remaining } = computeVisibleLines(
    displayText,
    expanded,
    maxLines,
  );
  const showStructuredLayout = expanded && presentationKind !== undefined;
  const headerLabel = showStructuredLayout
    ? buildKindHeader(presentationKind, meta, argsSummary, displayText)
    : undefined;

  if (showStructuredLayout && presentationKind === "shell") {
    let activeSection: "stdout" | "stderr" | null = null;
    const body = renderStructuredLines(
      visibleLines,
      width,
      (line) => {
        const trimmed = line.trim();
        if (trimmed === "stdout:") {
          activeSection = "stdout";
          return sc.chrome.sectionLabel;
        }
        if (trimmed === "stderr:") {
          activeSection = "stderr";
          return sc.status.warning;
        }
        if (/^exit\s+\d+/i.test(trimmed)) {
          const exitCode = Number(trimmed.replace(/^exit\s+/i, ""));
          return Number.isFinite(exitCode) && exitCode === 0
            ? sc.status.success
            : sc.status.warning;
        }
        if (activeSection === "stderr") {
          return tone === "error" ? sc.status.error : sc.status.warning;
        }
        return resolveStructuredToneColor(sc, tone, "default", contentType);
      },
    );

    return (
      <Box flexDirection="column">
        {headerLabel && (
          <Text color={sc.chrome.sectionLabel}>{headerLabel}</Text>
        )}
        {body}
        {truncated && (
          <Text color={tone === "error" ? sc.status.error : sc.text.muted}>
            … (+{remaining} lines · {TOGGLE_LATEST_HINT})
          </Text>
        )}
      </Box>
    );
  }

  if (showStructuredLayout) {
    const body = renderStructuredLines(
      visibleLines,
      width,
      (line) => {
        if (presentationKind === "web" && isUrlLike(line)) {
          return sc.chrome.sectionLabel;
        }
        if (presentationKind === "search" && /\b(match|result)\b/i.test(line)) {
          return sc.chrome.sectionLabel;
        }
        if (
          presentationKind === "edit" &&
          (/^(ERROR|WARN|HINT)\b/.test(line.trim()) ||
            /\bnot assignable\b/i.test(line))
        ) {
          return /\bWARN|HINT\b/.test(line) ? sc.status.warning : sc.status.error;
        }
        if (
          presentationKind === "read" &&
          (line.startsWith("File ") || line.startsWith("--- "))
        ) {
          return sc.chrome.sectionLabel;
        }
        return resolveStructuredToneColor(sc, tone, "default", contentType);
      },
    );

    return (
      <Box flexDirection="column">
        {headerLabel && (
          <Text color={sc.chrome.sectionLabel}>{headerLabel}</Text>
        )}
        {toolName && presentationKind === "meta" && argsSummary?.trim() && (
          <Text color={sc.text.muted}>{`${toolName} · ${argsSummary.trim()}`}</Text>
        )}
        {body}
        {truncated && (
          <Text color={tone === "error" ? sc.status.error : sc.text.muted}>
            … (+{remaining} lines · {TOGGLE_LATEST_HINT})
          </Text>
        )}
      </Box>
    );
  }

  if (presentationKind === "shell") {
    const compactShell = buildCompactShellResult(displayText, maxLines);
    return (
      <Box flexDirection="column">
        {compactShell.visibleLines.map((line, i) => (
          <Box key={i}>
            <Text
              color={line.tone === "error"
                ? sc.status.error
                : line.tone === "muted"
                ? sc.text.muted
                : sc.text.secondary}
            >
              {truncateLine(line.text, width)}
            </Text>
          </Box>
        ))}
        {compactShell.truncated && (
          <Text color={tone === "error" ? sc.status.error : sc.text.muted}>
            … (+{compactShell.remaining} earlier · {TOGGLE_LATEST_HINT})
          </Text>
        )}
      </Box>
    );
  }

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
          … (+{remaining} lines · {TOGGLE_LATEST_HINT})
        </Text>
      )}
    </Box>
  );
});
