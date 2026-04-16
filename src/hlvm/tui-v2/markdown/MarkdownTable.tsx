import type { Token, Tokens } from "npm:marked@^17";
import React from "react";
import stripAnsi from "strip-ansi";
import { useTerminalSize } from "../hooks/useTerminalSize.ts";
import { Ansi } from "../ink/Ansi.tsx";
import { stringWidth } from "../ink/stringWidth.ts";
import { wrapAnsi } from "../ink/wrapAnsi.ts";
import type { CliHighlight } from "../utils/cliHighlight.ts";
import { formatToken, padAligned } from "../utils/markdown.ts";

const SAFETY_MARGIN = 4;
const MIN_COLUMN_WIDTH = 3;
const MAX_ROW_LINES = 4;
const ANSI_BOLD_START = "\x1b[1m";
const ANSI_BOLD_END = "\x1b[22m";

type Props = {
  token: Tokens.Table;
  highlight?: CliHighlight | null;
  forceWidth?: number;
};

function wrapText(
  text: string,
  width: number,
  options?: { hard?: boolean },
): string[] {
  if (width <= 0) return [text];

  const trimmedText = text.trimEnd();
  const wrapped = wrapAnsi(trimmedText, width, {
    hard: options?.hard ?? false,
    trim: false,
    wordWrap: true,
  });
  const lines = wrapped.split("\n").filter((line) => line.length > 0);
  return lines.length > 0 ? lines : [""];
}

export function MarkdownTable({
  token,
  highlight = null,
  forceWidth,
}: Props): React.ReactNode {
  const { columns: actualTerminalWidth } = useTerminalSize();
  const terminalWidth = forceWidth ?? actualTerminalWidth;

  function formatCell(tokens: Token[] | undefined): string {
    return tokens?.map((child) => formatToken(child, 0, null, null, highlight))
      .join("") ?? "";
  }

  function getPlainText(tokens: Token[] | undefined): string {
    return stripAnsi(formatCell(tokens));
  }

  function getMinWidth(tokens: Token[] | undefined): number {
    const text = getPlainText(tokens);
    const words = text.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) return MIN_COLUMN_WIDTH;
    return Math.max(
      ...words.map((word) => stringWidth(word)),
      MIN_COLUMN_WIDTH,
    );
  }

  function getIdealWidth(tokens: Token[] | undefined): number {
    return Math.max(stringWidth(getPlainText(tokens)), MIN_COLUMN_WIDTH);
  }

  const minWidths = token.header.map((header, colIndex) => {
    let maxMinWidth = getMinWidth(header.tokens);
    for (const row of token.rows) {
      maxMinWidth = Math.max(maxMinWidth, getMinWidth(row[colIndex]?.tokens));
    }
    return maxMinWidth;
  });
  const idealWidths = token.header.map((header, colIndex) => {
    let maxIdeal = getIdealWidth(header.tokens);
    for (const row of token.rows) {
      maxIdeal = Math.max(maxIdeal, getIdealWidth(row[colIndex]?.tokens));
    }
    return maxIdeal;
  });

  const numCols = token.header.length;
  const borderOverhead = 1 + numCols * 3;
  const availableWidth = Math.max(
    terminalWidth - borderOverhead - SAFETY_MARGIN,
    numCols * MIN_COLUMN_WIDTH,
  );

  const totalMin = minWidths.reduce((sum, width) => sum + width, 0);
  const totalIdeal = idealWidths.reduce((sum, width) => sum + width, 0);

  let needsHardWrap = false;
  let columnWidths: number[];
  if (totalIdeal <= availableWidth) {
    columnWidths = idealWidths;
  } else if (totalMin <= availableWidth) {
    const extraSpace = availableWidth - totalMin;
    const overflows = idealWidths.map((ideal, index) => ideal - minWidths[index]!);
    const totalOverflow = overflows.reduce((sum, overflow) => sum + overflow, 0);
    columnWidths = minWidths.map((min, index) => {
      if (totalOverflow === 0) return min;
      const extra = Math.floor(overflows[index]! / totalOverflow * extraSpace);
      return min + extra;
    });
  } else {
    needsHardWrap = true;
    const scaleFactor = availableWidth / totalMin;
    columnWidths = minWidths.map((width) =>
      Math.max(Math.floor(width * scaleFactor), MIN_COLUMN_WIDTH)
    );
  }

  function calculateMaxRowLines(): number {
    let maxLines = 1;
    for (let i = 0; i < token.header.length; i++) {
      const content = formatCell(token.header[i]!.tokens);
      const wrapped = wrapText(content, columnWidths[i]!, { hard: needsHardWrap });
      maxLines = Math.max(maxLines, wrapped.length);
    }
    for (const row of token.rows) {
      for (let i = 0; i < row.length; i++) {
        const content = formatCell(row[i]?.tokens);
        const wrapped = wrapText(content, columnWidths[i]!, { hard: needsHardWrap });
        maxLines = Math.max(maxLines, wrapped.length);
      }
    }
    return maxLines;
  }

  const maxRowLines = calculateMaxRowLines();
  const useVerticalFormat = maxRowLines > MAX_ROW_LINES;

  function renderRowLines(
    cells: Array<{ tokens?: Token[] }>,
    isHeader: boolean,
  ): string[] {
    const cellLines = cells.map((cell, colIndex) => {
      const formattedText = formatCell(cell.tokens);
      const width = columnWidths[colIndex]!;
      return wrapText(formattedText, width, { hard: needsHardWrap });
    });

    const maxLines = Math.max(...cellLines.map((lines) => lines.length), 1);
    const verticalOffsets = cellLines.map((lines) =>
      Math.floor((maxLines - lines.length) / 2)
    );

    const result: string[] = [];
    for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
      let line = "│";
      for (let colIndex = 0; colIndex < cells.length; colIndex++) {
        const lines = cellLines[colIndex]!;
        const offset = verticalOffsets[colIndex]!;
        const contentLineIdx = lineIdx - offset;
        const lineText =
          contentLineIdx >= 0 && contentLineIdx < lines.length
            ? lines[contentLineIdx]!
            : "";
        const width = columnWidths[colIndex]!;
        const align = isHeader ? "center" : token.align?.[colIndex] ?? "left";
        line += " " +
          padAligned(lineText, stringWidth(stripAnsi(lineText)), width, align) +
          " │";
      }
      result.push(line);
    }
    return result;
  }

  function renderBorderLine(type: "top" | "middle" | "bottom"): string {
    const [left, mid, cross, right] = {
      top: ["┌", "─", "┬", "┐"],
      middle: ["├", "─", "┼", "┤"],
      bottom: ["└", "─", "┴", "┘"],
    }[type];

    let line = left;
    columnWidths.forEach((width, colIndex) => {
      line += mid.repeat(width + 2);
      line += colIndex < columnWidths.length - 1 ? cross : right;
    });
    return line;
  }

  function renderVerticalFormat(): string {
    const lines: string[] = [];
    const headers = token.header.map((header) => getPlainText(header.tokens));
    const separatorWidth = Math.min(terminalWidth - 1, 40);
    const separator = "─".repeat(separatorWidth);
    const wrapIndent = "  ";

    token.rows.forEach((row, rowIndex) => {
      if (rowIndex > 0) {
        lines.push(separator);
      }

      row.forEach((cell, colIndex) => {
        const label = headers[colIndex] || `Column ${colIndex + 1}`;
        const rawValue = formatCell(cell.tokens).trimEnd();
        const value = rawValue.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();

        const firstLineWidth = terminalWidth - stringWidth(label) - 3;
        const subsequentLineWidth = terminalWidth - wrapIndent.length - 1;
        const firstPassLines = wrapText(value, Math.max(firstLineWidth, 10));
        const firstLine = firstPassLines[0] || "";
        let wrappedValue: string[];

        if (
          firstPassLines.length <= 1 ||
          subsequentLineWidth <= firstLineWidth
        ) {
          wrappedValue = firstPassLines;
        } else {
          const remainingText = firstPassLines.slice(1).map((line) => line.trim())
            .join(" ");
          const rewrapped = wrapText(remainingText, subsequentLineWidth);
          wrappedValue = [firstLine, ...rewrapped];
        }

        lines.push(
          `${ANSI_BOLD_START}${label}:${ANSI_BOLD_END} ${wrappedValue[0] || ""}`,
        );
        for (let i = 1; i < wrappedValue.length; i++) {
          const line = wrappedValue[i]!;
          if (!line.trim()) continue;
          lines.push(`${wrapIndent}${line}`);
        }
      });
    });

    return lines.join("\n");
  }

  if (useVerticalFormat) {
    return <Ansi>{renderVerticalFormat()}</Ansi>;
  }

  const tableLines: string[] = [];
  tableLines.push(renderBorderLine("top"));
  tableLines.push(...renderRowLines(token.header, true));
  tableLines.push(renderBorderLine("middle"));
  token.rows.forEach((row, rowIndex) => {
    tableLines.push(...renderRowLines(row, false));
    if (rowIndex < token.rows.length - 1) {
      tableLines.push(renderBorderLine("middle"));
    }
  });
  tableLines.push(renderBorderLine("bottom"));

  const maxLineWidth = Math.max(
    ...tableLines.map((line) => stringWidth(stripAnsi(line))),
  );

  if (maxLineWidth > terminalWidth - SAFETY_MARGIN) {
    return <Ansi>{renderVerticalFormat()}</Ansi>;
  }

  return <Ansi>{tableLines.join("\n")}</Ansi>;
}
