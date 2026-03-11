import React, { memo } from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { CodeBlock } from "./CodeBlock.tsx";
import { InlineMarkdown } from "./InlineMarkdown.tsx";

type Alignment = "left" | "center" | "right";

type Block =
  | { type: "code"; language?: string; content: string; incomplete?: boolean }
  | { type: "heading"; level: number; content: string }
  | { type: "list"; bullet: string; indent: number; content: string }
  | { type: "quote"; content: string }
  | { type: "hr" }
  | { type: "table"; headers: string[]; alignments: Alignment[]; rows: string[][] }
  | { type: "paragraph"; content: string };

interface MarkdownDisplayProps {
  text: string;
  width: number;
  isPending?: boolean;
}

function isTableLine(line: string): boolean {
  const trimmed = line.trimEnd();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length > 2;
}

function isSpecialLine(line: string): boolean {
  return /^```/.test(line) || /^#{1,4}\s+/.test(line) || /^(\s*)([-*+]|\d+\.)\s+/.test(line) ||
    /^>\s?/.test(line) || /^-{3,}\s*$/.test(line) || isTableLine(line);
}

function parseCells(line: string): string[] {
  return line.split("|").slice(1, -1).map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

function parseAlignment(cell: string): Alignment {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

function parseBlocks(text: string, isPending: boolean): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim().length === 0) {
      i++;
      continue;
    }

    const codeStart = line.match(/^```\s*([\w-]+)?\s*$/);
    if (codeStart) {
      const language = codeStart[1] || undefined;
      i++;
      const codeLines: string[] = [];
      let closed = false;
      while (i < lines.length) {
        if (/^```\s*$/.test(lines[i] ?? "")) {
          closed = true;
          i++;
          break;
        }
        codeLines.push(lines[i] ?? "");
        i++;
      }
      blocks.push({
        type: "code",
        language,
        content: codeLines.join("\n"),
        incomplete: !closed && isPending,
      });
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        content: headingMatch[2],
      });
      i++;
      continue;
    }

    // Table: consecutive | ... | lines with a separator row
    if (isTableLine(line)) {
      const tableLines: string[] = [line];
      i++;
      while (i < lines.length && isTableLine(lines[i] ?? "")) {
        tableLines.push(lines[i] ?? "");
        i++;
      }

      const parsedRows = tableLines.map(parseCells);
      const hasSeparator = parsedRows.length >= 2 && isSeparatorRow(parsedRows[1]);

      if (hasSeparator && parsedRows.length >= 3) {
        const headers = parsedRows[0];
        const alignments = parsedRows[1].map(parseAlignment);
        const rows = parsedRows.slice(2);
        blocks.push({ type: "table", headers, alignments, rows });
      } else {
        // Not a valid table — render each line as a separate paragraph
        for (const tl of tableLines) {
          blocks.push({ type: "paragraph", content: tl });
        }
      }
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      blocks.push({
        type: "list",
        indent: Math.floor((listMatch[1] ?? "").length / 2),
        bullet: listMatch[2],
        content: listMatch[3],
      });
      i++;
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      blocks.push({ type: "quote", content: quoteMatch[1] ?? "" });
      i++;
      continue;
    }

    if (/^-{3,}\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    const paragraph: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (next.trim().length === 0 || isSpecialLine(next)) break;
      paragraph.push(next);
      i++;
    }
    blocks.push({ type: "paragraph", content: paragraph.join(" ") });
  }

  return blocks;
}

/**
 * Pad or truncate a string to exactly `width` characters with given alignment.
 */
function alignCell(text: string, width: number, alignment: Alignment): string {
  if (text.length > width) {
    return text.slice(0, Math.max(1, width - 1)) + "…";
  }
  const pad = width - text.length;
  if (alignment === "right") return " ".repeat(pad) + text;
  if (alignment === "center") {
    const left = Math.floor(pad / 2);
    return " ".repeat(left) + text + " ".repeat(pad - left);
  }
  return text + " ".repeat(pad);
}

interface TableBlockProps {
  headers: string[];
  alignments: Alignment[];
  rows: string[][];
  width: number;
}

const TableBlock = memo(function TableBlock(
  { headers, alignments, rows, width }: TableBlockProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const colCount = headers.length;
  // Gap between columns
  const gap = 2;
  // Available width for all column content (minus gaps between columns)
  const totalGapWidth = gap * (colCount - 1);
  const availableForContent = Math.max(colCount * 3, width - totalGapWidth);

  // Compute natural column widths from content
  const naturalWidths = headers.map((h, colIdx) => {
    let maxLen = h.length;
    for (const row of rows) {
      const cell = row[colIdx] ?? "";
      maxLen = Math.max(maxLen, cell.length);
    }
    return maxLen;
  });

  const totalNatural = naturalWidths.reduce((a, b) => a + b, 0);

  // Scale columns proportionally if total exceeds available width
  const colWidths = totalNatural <= availableForContent
    ? naturalWidths
    : naturalWidths.map((w) =>
      Math.max(3, Math.floor((w / totalNatural) * availableForContent))
    );

  const separator = colWidths.map((w) => "─".repeat(w)).join("  ");

  const renderRow = (cells: string[], bold: boolean, key: string) => {
    const parts = colWidths.map((w, ci) => {
      const cell = cells[ci] ?? "";
      const align = alignments[ci] ?? "left";
      return alignCell(cell, w, align);
    });
    const line = parts.join("  ");
    return (
      <Box key={key}>
        {bold
          ? <Text bold>{line}</Text>
          : <InlineMarkdown text={line} />}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" marginY={0}>
      {renderRow(headers, true, "header")}
      <Box>
        <Text color={sc.text.muted}>{separator}</Text>
      </Box>
      {rows.map((row, ri) => renderRow(row, false, `row-${ri}`))}
    </Box>
  );
});

export const MarkdownDisplay = memo(function MarkdownDisplay(
  { text, width, isPending = false }: MarkdownDisplayProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const blocks = parseBlocks(text, isPending);

  return (
    <Box flexDirection="column">
      {blocks.map((block: Block, index: number) => {
        if (block.type === "code") {
          return (
            <Box key={index} marginY={1}>
              <CodeBlock code={block.content} language={block.language} width={width} />
              {block.incomplete && (
                <Text color={sc.text.muted}>Generating more...</Text>
              )}
            </Box>
          );
        }

        if (block.type === "heading") {
          const color = block.level <= 2 ? sc.status.success : sc.text.primary;
          return (
            <Box key={index}>
              <Text color={color} bold>
                {block.content}
              </Text>
            </Box>
          );
        }

        if (block.type === "list") {
          const indent = "  ".repeat(Math.max(0, block.indent));
          return (
            <Box key={index}>
              <Text>{indent}</Text>
              <Text color={sc.text.muted}>{block.bullet} </Text>
              <InlineMarkdown text={block.content} />
            </Box>
          );
        }

        if (block.type === "quote") {
          return (
            <Box key={index}>
              <Text color={sc.text.secondary}>│ </Text>
              <InlineMarkdown text={block.content} />
            </Box>
          );
        }

        if (block.type === "hr") {
          return (
            <Box key={index}>
              <Text color={sc.text.muted}>
                {"─".repeat(Math.max(10, width - 6))}
              </Text>
            </Box>
          );
        }

        if (block.type === "table") {
          return (
            <TableBlock
              key={index}
              headers={block.headers}
              alignments={block.alignments}
              rows={block.rows}
              width={width}
            />
          );
        }

        return (
          <InlineMarkdown key={index} text={block.content} />
        );
      })}
    </Box>
  );
});
