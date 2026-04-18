import chalk from "chalk";
import React, { memo, useMemo, useRef } from "react";
import { Box, Text } from "ink";
import stripAnsi from "strip-ansi";
import { marked, type Token, type Tokens } from "marked";
import { useSemanticColors } from "../../../theme/index.ts";
import { Ansi } from "../../../../tui-v2/ink/Ansi.tsx";
import { stringWidth } from "../../../../tui-v2/ink/stringWidth.ts";
import { wrapAnsi } from "../../../../tui-v2/ink/wrapAnsi.ts";
import { CodeBlock } from "./CodeBlock.tsx";
import { InlineMarkdown, InlineTokens } from "./InlineMarkdown.tsx";
import {
  type BlockBoundaryScanState,
  scanBlockBoundaryIncremental,
} from "../../utils/markdown-split.ts";

type Alignment = "left" | "center" | "right";
type SemanticColors = ReturnType<typeof useSemanticColors>;

interface MarkdownDisplayProps {
  text: string;
  width: number;
  isPending?: boolean;
}

function mapAlignment(align: string | null): Alignment {
  if (align === "center") return "center";
  if (align === "right") return "right";
  return "left";
}

const TABLE_SAFETY_MARGIN = 4;
const TABLE_MIN_COLUMN_WIDTH = 3;
const TABLE_MAX_ROW_LINES = 4;

function styleAnsi(
  text: string,
  color: string,
  options?: {
    bold?: boolean;
    dim?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
  },
): string {
  let painter = chalk.hex(color);
  if (options?.bold) painter = painter.bold;
  if (options?.dim) painter = painter.dim;
  if (options?.italic) painter = painter.italic;
  if (options?.underline) painter = painter.underline;
  if (options?.strikethrough) painter = painter.strikethrough;
  return painter(text);
}

function renderInlineAnsi(tokens: Token[] | undefined, sc: SemanticColors): string {
  return tokens?.map((token) => renderInlineAnsiToken(token, sc)).join("") ?? "";
}

function renderInlineAnsiToken(token: Token, sc: SemanticColors): string {
  switch (token.type) {
    case "strong":
      return styleAnsi(
        renderInlineAnsi((token as Tokens.Strong).tokens, sc),
        sc.text.primary,
        { bold: true },
      );
    case "em":
      return styleAnsi(
        renderInlineAnsi((token as Tokens.Em).tokens, sc),
        sc.text.primary,
        { italic: true },
      );
    case "codespan":
      return styleAnsi((token as Tokens.Codespan).text, sc.syntax.keyword);
    case "link": {
      const linkToken = token as Tokens.Link;
      const label = linkToken.tokens?.length
        ? renderInlineAnsi(linkToken.tokens, sc)
        : (linkToken.text || linkToken.href);
      return styleAnsi(label, sc.syntax.keyword, { underline: true });
    }
    case "del":
      return styleAnsi(
        renderInlineAnsi((token as Tokens.Del).tokens, sc),
        sc.text.muted,
        { strikethrough: true },
      );
    case "br":
      return "\n";
    case "escape":
      return (token as Tokens.Escape).text;
    default:
      return "text" in token ? (token as Tokens.Text).text : String(token.raw ?? "");
  }
}

function normalizeTableText(text: string): string {
  return text.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
}

function getPlainTableText(tokens: Token[] | undefined, sc: SemanticColors): string {
  return normalizeTableText(stripAnsi(renderInlineAnsi(tokens, sc)));
}

function getAnsiTableText(tokens: Token[] | undefined, sc: SemanticColors): string {
  return normalizeTableText(renderInlineAnsi(tokens, sc));
}

function padAlignedAnsi(
  text: string,
  visibleWidth: number,
  width: number,
  alignment: Alignment,
): string {
  const pad = Math.max(0, width - visibleWidth);
  if (alignment === "right") return `${" ".repeat(pad)}${text}`;
  if (alignment === "center") {
    const left = Math.floor(pad / 2);
    return `${" ".repeat(left)}${text}${" ".repeat(pad - left)}`;
  }
  return `${text}${" ".repeat(pad)}`;
}

function wrapTableCell(
  text: string,
  width: number,
  hard: boolean,
): string[] {
  if (width <= 0) return [text];
  const wrapped = wrapAnsi(text.trimEnd(), width, {
    hard,
    trim: false,
    wordWrap: true,
  });
  const lines = wrapped.split("\n");
  return lines.length > 0 ? lines : [""];
}

interface TableBlockProps {
  token: Tokens.Table;
  width: number;
}

const TableBlock = memo(function TableBlock(
  { token, width }: TableBlockProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const rendered = useMemo(() => {
    const numCols = token.header.length;
    const alignments = token.align.map(mapAlignment);
    const borderColor = sc.text.primary;

    const minWidths = token.header.map((header, colIndex) => {
      let maxMinWidth = Math.max(
        TABLE_MIN_COLUMN_WIDTH,
        ...getPlainTableText(header.tokens, sc)
          .split(/\s+/)
          .filter(Boolean)
          .map((word) => stringWidth(word)),
      );
      for (const row of token.rows) {
        const words = getPlainTableText(row[colIndex]?.tokens, sc)
          .split(/\s+/)
          .filter(Boolean);
        const cellMinWidth = words.length > 0
          ? Math.max(...words.map((word) => stringWidth(word)))
          : TABLE_MIN_COLUMN_WIDTH;
        maxMinWidth = Math.max(maxMinWidth, cellMinWidth);
      }
      return maxMinWidth;
    });

    const idealWidths = token.header.map((header, colIndex) => {
      let maxIdealWidth = Math.max(
        stringWidth(getPlainTableText(header.tokens, sc)),
        TABLE_MIN_COLUMN_WIDTH,
      );
      for (const row of token.rows) {
        maxIdealWidth = Math.max(
          maxIdealWidth,
          stringWidth(getPlainTableText(row[colIndex]?.tokens, sc)),
        );
      }
      return maxIdealWidth;
    });

    const borderOverhead = 1 + numCols * 3;
    const availableWidth = Math.max(
      width - borderOverhead - TABLE_SAFETY_MARGIN,
      numCols * TABLE_MIN_COLUMN_WIDTH,
    );

    const totalMin = minWidths.reduce((sum, value) => sum + value, 0);
    const totalIdeal = idealWidths.reduce((sum, value) => sum + value, 0);

    let needsHardWrap = false;
    let columnWidths: number[];
    if (totalIdeal <= availableWidth) {
      columnWidths = idealWidths;
    } else if (totalMin <= availableWidth) {
      const extraSpace = availableWidth - totalMin;
      const overflows = idealWidths.map((ideal, index) => ideal - minWidths[index]!);
      const totalOverflow = overflows.reduce((sum, value) => sum + value, 0);
      columnWidths = minWidths.map((minWidth, index) => {
        if (totalOverflow === 0) return minWidth;
        const extra = Math.floor(overflows[index]! / totalOverflow * extraSpace);
        return minWidth + extra;
      });
    } else {
      needsHardWrap = true;
      const scaleFactor = availableWidth / Math.max(1, totalMin);
      columnWidths = minWidths.map((value) =>
        Math.max(Math.floor(value * scaleFactor), TABLE_MIN_COLUMN_WIDTH)
      );
    }

    const formatCell = (
      cellTokens: Token[] | undefined,
      options?: { header?: boolean },
    ): string => {
      const content = getAnsiTableText(cellTokens, sc);
      return options?.header
        ? styleAnsi(content, sc.text.primary, { bold: true })
        : content;
    };

    const renderRowLines = (
      cells: Array<{ tokens?: Token[] }>,
      header = false,
    ): string[] => {
      const cellLines = cells.map((cell, index) =>
        wrapTableCell(
          formatCell(cell.tokens, { header }),
          columnWidths[index]!,
          needsHardWrap,
        )
      );
      const maxLines = Math.max(...cellLines.map((lines) => lines.length), 1);
      const verticalOffsets = cellLines.map((lines) =>
        Math.floor((maxLines - lines.length) / 2)
      );

      const lines: string[] = [];
      for (let lineIndex = 0; lineIndex < maxLines; lineIndex++) {
        let line = styleAnsi("│", borderColor);
        for (let colIndex = 0; colIndex < cells.length; colIndex++) {
          const wrappedLines = cellLines[colIndex]!;
          const offset = verticalOffsets[colIndex]!;
          const contentLineIndex = lineIndex - offset;
          const lineText = contentLineIndex >= 0 && contentLineIndex < wrappedLines.length
            ? wrappedLines[contentLineIndex]!
            : "";
          const alignment = header ? "center" : (alignments[colIndex] ?? "left");
          line += ` ${
            padAlignedAnsi(
              lineText,
              stringWidth(stripAnsi(lineText)),
              columnWidths[colIndex]!,
              alignment,
            )
          } ${styleAnsi("│", borderColor)}`;
        }
        lines.push(line);
      }
      return lines;
    };

    const renderBorderLine = (type: "top" | "middle" | "bottom"): string => {
      const [left, mid, cross, right] = {
        top: ["┌", "─", "┬", "┐"],
        middle: ["├", "─", "┼", "┤"],
        bottom: ["└", "─", "┴", "┘"],
      }[type];

      let line = left;
      columnWidths.forEach((columnWidth, index) => {
        line += mid.repeat(columnWidth + 2);
        line += index < columnWidths.length - 1 ? cross : right;
      });
      return styleAnsi(line, borderColor);
    };

    const calculateMaxRowLines = (): number => {
      let maxLines = 1;
      for (let index = 0; index < token.header.length; index++) {
        maxLines = Math.max(
          maxLines,
          wrapTableCell(
            formatCell(token.header[index]!.tokens, { header: true }),
            columnWidths[index]!,
            needsHardWrap,
          ).length,
        );
      }
      for (const row of token.rows) {
        for (let index = 0; index < row.length; index++) {
          maxLines = Math.max(
            maxLines,
            wrapTableCell(
              formatCell(row[index]?.tokens),
              columnWidths[index]!,
              needsHardWrap,
            ).length,
          );
        }
      }
      return maxLines;
    };

    const renderVerticalFormat = (): string => {
      const separatorWidth = Math.min(width - 1, 40);
      const separator = styleAnsi("─".repeat(separatorWidth), borderColor);
      const lines: string[] = [];

      token.rows.forEach((row, rowIndex) => {
        if (rowIndex > 0) lines.push(separator);
        row.forEach((cell, colIndex) => {
          const label = getPlainTableText(token.header[colIndex]?.tokens, sc) ||
            `Column ${colIndex + 1}`;
          const value = getAnsiTableText(cell.tokens, sc);
          const firstLineWidth = Math.max(10, width - stringWidth(label) - 3);
          const continuationWidth = Math.max(10, width - 3);
          const firstPass = wrapTableCell(value, firstLineWidth, needsHardWrap);
          const firstLine = firstPass[0] ?? "";
          let wrappedValue = firstPass;
          if (firstPass.length > 1 && continuationWidth > firstLineWidth) {
            const remainingText = firstPass.slice(1).join(" ");
            wrappedValue = [
              firstLine,
              ...wrapTableCell(remainingText, continuationWidth, needsHardWrap),
            ];
          }

          lines.push(
            `${styleAnsi(label, sc.text.primary, { bold: true })}: ${wrappedValue[0] ?? ""}`,
          );
          for (let index = 1; index < wrappedValue.length; index++) {
            lines.push(`  ${wrappedValue[index]!}`);
          }
        });
      });

      return lines.join("\n");
    };

    if (calculateMaxRowLines() > TABLE_MAX_ROW_LINES) {
      return renderVerticalFormat();
    }

    const tableLines: string[] = [];
    tableLines.push(renderBorderLine("top"));
    tableLines.push(...renderRowLines(token.header, true));
    tableLines.push(renderBorderLine("middle"));
    token.rows.forEach((row, rowIndex) => {
      tableLines.push(...renderRowLines(row));
      if (rowIndex < token.rows.length - 1) {
        tableLines.push(renderBorderLine("middle"));
      }
    });
    tableLines.push(renderBorderLine("bottom"));

    const maxLineWidth = Math.max(
      ...tableLines.map((line) => stringWidth(stripAnsi(line))),
    );
    if (maxLineWidth > width - TABLE_SAFETY_MARGIN) {
      return renderVerticalFormat();
    }

    return tableLines.join("\n");
  }, [sc, token, width]);

  return (
    <Box flexDirection="column" marginY={0}>
      <Ansi>{rendered}</Ansi>
    </Box>
  );
});

/**
 * Renders a single marked block token to Ink components.
 */
function renderBlock(
  token: Token,
  width: number,
  sc: SemanticColors,
  isPending?: boolean,
): React.ReactElement | null {
  switch (token.type) {
    case "code": {
      const t = token as Tokens.Code;
      return (
        <Box marginY={1}>
          <CodeBlock
            code={t.text}
            language={t.lang}
            width={width}
            isPending={isPending}
          />
        </Box>
      );
    }
    case "heading": {
      const t = token as Tokens.Heading;
      const color = t.depth <= 2 ? sc.status.success : sc.text.primary;
      return (
        <Box>
          <Text color={color} bold>
            <InlineTokens tokens={t.tokens} />
          </Text>
        </Box>
      );
    }
    case "paragraph": {
      const t = token as Tokens.Paragraph;
      if (!t.text.includes("\n")) {
        return <InlineTokens tokens={t.tokens} />;
      }
      return (
        <Box flexDirection="column">
          {t.text.split("\n").map((line: string, index: number) => (
            <Box key={index}>
              <InlineMarkdown text={line} />
            </Box>
          ))}
        </Box>
      );
    }
    case "list": {
      const t = token as Tokens.List;
      return (
        <Box flexDirection="column">
          {t.items.map((item: Tokens.ListItem, i: number) => {
            const isTask = typeof item.checked === "boolean";
            const bullet = isTask
              ? (item.checked ? "[x]" : "[ ]")
              : t.ordered
              ? `${Number(t.start) + i}.`
              : "•";

            // Collect inline tokens from list item sub-tokens.
            // Tight lists emit `text` tokens with nested inline `tokens`.
            // Loose lists emit `paragraph` tokens. Task lists also have `checkbox` tokens.
            const inlineTokens: Token[] = [];
            let hasBlockContent = false;
            if (item.tokens) {
              for (const sub of item.tokens) {
                if (sub.type === "checkbox") continue; // handled by bullet prefix
                if (
                  sub.type === "text" && "tokens" in sub &&
                  Array.isArray((sub as Tokens.Text).tokens)
                ) {
                  inlineTokens.push(...(sub as Tokens.Text).tokens!);
                } else if (sub.type === "paragraph" || sub.type === "list") {
                  hasBlockContent = true;
                  break;
                } else {
                  inlineTokens.push(sub);
                }
              }
            }

            return (
              <Box key={i}>
                <Text color={sc.text.muted}>{bullet}</Text>
                {hasBlockContent
                  ? (
                    <Box flexDirection="column">
                      {item.tokens!
                        .filter((s: Token) => s.type !== "checkbox")
                        .map((subToken: Token, si: number) => (
                          <React.Fragment key={si}>
                            {subToken.type === "text" && "tokens" in subToken &&
                                Array.isArray((subToken as Tokens.Text).tokens)
                              ? (
                                <InlineTokens
                                  tokens={(subToken as Tokens.Text).tokens!}
                                />
                              )
                              : renderBlock(subToken, width, sc, isPending)}
                          </React.Fragment>
                        ))}
                    </Box>
                  )
                  : inlineTokens.length > 0
                  ? <InlineTokens tokens={inlineTokens} />
                  : <Text>{item.text}</Text>}
              </Box>
            );
          })}
        </Box>
      );
    }
    case "table": {
      return <TableBlock token={token as Tokens.Table} width={width} />;
    }
    case "blockquote": {
      const t = token as Tokens.Blockquote;
      return (
        <Box flexDirection="column">
          {t.tokens.flatMap((subToken: Token, i: number) => {
            // For paragraphs, split on newlines so each line gets its own │ prefix
            if (subToken.type === "paragraph") {
              const para = subToken as Tokens.Paragraph;
              const lines = para.text.split("\n");
              return lines.map((line: string, li: number) => (
                <Box key={`${i}-${li}`}>
                  <Text color={sc.text.secondary}>│</Text>
                  <Box flexShrink={1}>
                    <InlineMarkdown text={line} />
                  </Box>
                </Box>
              ));
            }
            // Other block tokens get one prefix per block
            return [
              (
                <Box key={i}>
                  <Text color={sc.text.secondary}>│</Text>
                  <Box flexShrink={1}>
                    {renderBlock(subToken, width - 2, sc, isPending)}
                  </Box>
                </Box>
              ),
            ];
          })}
        </Box>
      );
    }
    case "hr":
      return (
        <Box>
          <Text color={sc.text.muted}>
            {"─".repeat(Math.max(10, width - 6))}
          </Text>
        </Box>
      );
    case "space":
      return null;
    default:
      // Fallback: render raw text
      if ("text" in token) {
        return <Text>{(token as { text: string }).text}</Text>;
      }
      return null;
  }
}

export const MarkdownDisplay = memo(function MarkdownDisplay(
  { text, width, isPending }: MarkdownDisplayProps,
): React.ReactElement {
  const sc = useSemanticColors();

  // Incremental block-level parsing: during streaming, only re-parse the unstable tail.
  // Finalized blocks (before the last \n\n outside code fences) are cached across renders.
  const blocksRef = useRef<
    { finalizedTokens: Token[]; lastStableOffset: number }
  >({
    finalizedTokens: [],
    lastStableOffset: 0,
  });
  const scanStateRef = useRef<BlockBoundaryScanState | undefined>(undefined);
  const previousTextRef = useRef("");

  const tokens = useMemo(() => {
    if (!isPending) {
      // Final render: parse everything fresh, clear cache
      blocksRef.current = { finalizedTokens: [], lastStableOffset: 0 };
      scanStateRef.current = undefined;
      previousTextRef.current = text;
      return marked.lexer(text);
    }

    const prev = blocksRef.current;

    // Detect text replacement (not append) — reset cache
    if (
      text.length < prev.lastStableOffset ||
      (previousTextRef.current.length > 0 &&
        !text.startsWith(previousTextRef.current))
    ) {
      prev.finalizedTokens = [];
      prev.lastStableOffset = 0;
      scanStateRef.current = undefined;
    }

    // Find last stable block boundary (incremental: O(delta) per flush)
    const { boundary: stableEnd, state: nextScanState } =
      scanBlockBoundaryIncremental(
        text,
        scanStateRef.current,
      );
    scanStateRef.current = nextScanState;

    if (stableEnd > prev.lastStableOffset) {
      // New stable content: parse only the new stable portion
      const newStableText = text.slice(prev.lastStableOffset, stableEnd);
      const newTokens = marked.lexer(newStableText);
      prev.finalizedTokens = [...prev.finalizedTokens, ...newTokens];
      prev.lastStableOffset = stableEnd;
    }

    // Parse only the unstable tail
    const tail = text.slice(stableEnd);
    const tailTokens = tail ? marked.lexer(tail) : [];
    previousTextRef.current = text;

    return [...prev.finalizedTokens, ...tailTokens];
  }, [text, isPending]);

  return (
    <Box flexDirection="column">
      {tokens.map((token: Token, index: number) => (
        <React.Fragment key={index}>
          {renderBlock(token, width, sc, isPending)}
        </React.Fragment>
      ))}
    </Box>
  );
});
