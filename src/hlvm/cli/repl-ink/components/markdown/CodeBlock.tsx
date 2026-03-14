import React, { memo, useMemo } from "react";
import { Box, Text } from "ink";
import { common, createLowlight } from "lowlight";
import { useSemanticColors } from "../../../theme/index.ts";

const lowlight = createLowlight(common);
const DEFAULT_MAX_LINES = 40;

interface StyledSegment {
  text: string;
  classes: string[];
}

interface StyledLine {
  segments: StyledSegment[];
}

interface CodeBlockProps {
  code: string;
  language?: string;
  width: number;
  maxLines?: number;
  isPending?: boolean;
  availableHeight?: number;
}

function splitSegmentsByNewline(segments: StyledSegment[]): StyledLine[] {
  const lines: StyledLine[] = [{ segments: [] }];

  for (const segment of segments) {
    const parts = segment.text.split("\n");
    parts.forEach((part: string, index: number) => {
      if (part.length > 0) {
        lines[lines.length - 1].segments.push({ ...segment, text: part });
      }
      if (index < parts.length - 1) {
        lines.push({ segments: [] });
      }
    });
  }

  return lines;
}

function collectSegments(node: unknown, inheritedClasses: string[] = []): StyledSegment[] {
  const n = node as {
    type?: string;
    value?: string;
    properties?: { className?: string[] | string };
    children?: unknown[];
  };

  if (n.type === "text") {
    return [{ text: n.value ?? "", classes: inheritedClasses }];
  }

  const ownClass = n.properties?.className;
  const ownClasses = Array.isArray(ownClass)
    ? ownClass
    : typeof ownClass === "string"
    ? [ownClass]
    : [];
  const classes = [...inheritedClasses, ...ownClasses];

  const children = n.children ?? [];
  const segments: StyledSegment[] = [];
  for (const child of children) {
    segments.push(...collectSegments(child, classes));
  }
  return segments;
}

function pickColorKey(classes: string[]): "keyword" | "string" | "number" | "comment" | "function" | "operator" | "default" {
  const joined = classes.join(" ");
  if (joined.includes("comment")) return "comment";
  if (joined.includes("string") || joined.includes("regexp")) return "string";
  if (joined.includes("number") || joined.includes("literal")) return "number";
  if (joined.includes("keyword") || joined.includes("built_in") || joined.includes("type")) return "keyword";
  if (joined.includes("title") || joined.includes("function")) return "function";
  if (joined.includes("operator") || joined.includes("punctuation")) return "operator";
  return "default";
}

function truncateLine(text: string, maxWidth: number): string {
  if (maxWidth < 4) return text;
  if (text.length <= maxWidth) return text;
  return `${text.slice(0, maxWidth - 1)}…`;
}

export const CodeBlock = memo(function CodeBlock(
  { code, language, width, maxLines = DEFAULT_MAX_LINES, isPending, availableHeight }: CodeBlockProps,
): React.ReactElement {
  const sc = useSemanticColors();

  const { visibleCode, totalLines, hiddenCount, needsTruncation } = useMemo(() => {
    const normalizedCode = code.replace(/\t/g, "  ");
    // Determine effective max lines: use availableHeight cap during streaming
    const effectiveMaxLines = isPending && availableHeight
      ? Math.min(maxLines, availableHeight)
      : maxLines;
    // Pre-slice optimization: split into raw lines first, slice to visible range,
    // THEN highlight only visible lines (avoids highlighting invisible content).
    const rawLines = normalizedCode.split("\n");
    const totalLines = rawLines.length;
    const needsTruncation = totalLines > effectiveMaxLines;
    const visibleRawLines = needsTruncation
      ? rawLines.slice(totalLines - effectiveMaxLines)
      : rawLines;
    const hiddenCount = totalLines - visibleRawLines.length;
    const visibleCode = visibleRawLines.join("\n");
    return { visibleCode, totalLines, hiddenCount, needsTruncation };
  }, [code, maxLines, isPending, availableHeight]);

  const hasLineNumbers = totalLines >= 5;

  const highlighted = useMemo(() => {
    try {
      if (language) return lowlight.highlight(language, visibleCode);
      return lowlight.highlightAuto(visibleCode);
    } catch {
      return lowlight.highlight("plaintext", visibleCode);
    }
  }, [language, visibleCode]);

  const segments = useMemo(() => collectSegments(highlighted), [highlighted]);
  const visibleLines = useMemo(() => splitSegmentsByNewline(segments), [segments]);

  const lineDigits = String(totalLines).length;
  const gutterWidth = hasLineNumbers ? lineDigits + 3 : 0;
  const contentWidth = Math.max(10, width - gutterWidth - 4);
  const badge = language || "code";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={sc.border.dim} paddingX={1}>
      <Text color={sc.text.muted}>{badge}</Text>
      {hiddenCount > 0 && (
        <Text color={sc.text.muted}>
          {isPending
            ? `… generating ${hiddenCount} more lines …`
            : `… ${hiddenCount} lines hidden above`}
        </Text>
      )}
      {visibleLines.map((line: StyledLine, index: number) => {
        const originalLineNumber = totalLines - visibleLines.length + index + 1;
        const plain = line.segments.map((segment: StyledSegment) => segment.text).join("");
        const isTruncated = plain.length > contentWidth;

        let remaining = contentWidth;
        const renderedSegments: StyledSegment[] = [];
        for (const segment of line.segments) {
          if (remaining <= 0) break;
          const nextText = segment.text.length > remaining
            ? segment.text.slice(0, remaining)
            : segment.text;
          if (nextText.length > 0) {
            renderedSegments.push({ ...segment, text: nextText });
            remaining -= nextText.length;
          }
        }

        return (
          <Box key={index}>
            {hasLineNumbers && (
              <Text color={sc.text.muted}>
                {String(originalLineNumber).padStart(lineDigits, " ")} │ 
              </Text>
            )}
            <Text>
              {renderedSegments.map((segment: StyledSegment, segIdx: number) => (
                <React.Fragment key={segIdx}>
                  <Text color={sc.syntax[pickColorKey(segment.classes)]}>
                    {segment.text}
                  </Text>
                </React.Fragment>
              ))}
              {isTruncated ? <Text color={sc.text.muted}>…</Text> : null}
            </Text>
          </Box>
        );
      })}
      {visibleLines.length === 0 && (
        <Text color={sc.text.muted}>{truncateLine("", contentWidth)}</Text>
      )}
    </Box>
  );
});
