import React, { memo, useMemo } from "react";
import { Box, Text } from "ink";
import { marked, type Token, type Tokens } from "marked";
import { useSemanticColors } from "../../../theme/index.ts";
import { CodeBlock } from "./CodeBlock.tsx";
import { InlineTokens, InlineMarkdown } from "./InlineMarkdown.tsx";

type Alignment = "left" | "center" | "right";

interface MarkdownDisplayProps {
  text: string;
  width: number;
  isPending?: boolean;
}

/**
 * Strip markdown formatting markers from text.
 * E.g. "**Tesla**" → "Tesla", "`code`" → "code".
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

/**
 * Get visible character count (stripped of markdown markers).
 * E.g. "**Tesla**" → 5 chars, not 10.
 */
function visibleLength(text: string): number {
  return stripMarkdown(text).length;
}

/**
 * Pad or truncate a string to exactly `width` visible characters with given alignment.
 */
function alignCell(text: string, width: number, alignment: Alignment): string {
  const visible = visibleLength(text);
  if (visible > width) {
    const stripped = stripMarkdown(text);
    return stripped.slice(0, Math.max(1, width - 1)) + "…";
  }
  const pad = width - visible;
  if (alignment === "right") return " ".repeat(pad) + text;
  if (alignment === "center") {
    const left = Math.floor(pad / 2);
    return " ".repeat(left) + text + " ".repeat(pad - left);
  }
  return text + " ".repeat(pad);
}

function mapAlignment(align: string | null): Alignment {
  if (align === "center") return "center";
  if (align === "right") return "right";
  return "left";
}

interface TableBlockProps {
  token: Tokens.Table;
  width: number;
}

const TableBlock = memo(function TableBlock(
  { token, width }: TableBlockProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const colCount = token.header.length;
  const gap = 2;
  const totalGapWidth = gap * (colCount - 1);
  const availableForContent = Math.max(colCount * 3, width - totalGapWidth);

  const alignments: Alignment[] = token.align.map(mapAlignment);

  // Compute natural column widths from visible text (stripped of markdown)
  const naturalWidths = token.header.map((h, colIdx) => {
    let maxLen = visibleLength(h.text);
    for (const row of token.rows) {
      const cell = row[colIdx];
      if (cell) {
        maxLen = Math.max(maxLen, visibleLength(cell.text));
      }
    }
    return maxLen;
  });

  const totalNatural = naturalWidths.reduce((a, b) => a + b, 0);

  const colWidths = totalNatural <= availableForContent
    ? naturalWidths
    : naturalWidths.map((w) =>
      Math.max(3, Math.floor((w / totalNatural) * availableForContent))
    );

  const separator = colWidths.map((w) => "─".repeat(w)).join("──");

  const renderCell = (
    cell: Tokens.TableCell | undefined,
    w: number,
    ci: number,
    align: Alignment,
    bold: boolean,
  ) => {
    const cellText = cell?.text ?? "";
    const padded = alignCell(cellText, w, align);

    // Try tokenized rendering when cell has inline formatting and fits
    if (cell?.tokens && cell.tokens.length > 0) {
      const visible = visibleLength(cellText);
      if (visible <= w) {
        const leftPad = align === "right"
          ? w - visible
          : align === "center"
          ? Math.floor((w - visible) / 2)
          : 0;
        const rightPad = w - visible - leftPad;
        return (
          <React.Fragment key={ci}>
            {leftPad > 0 && <Text>{" ".repeat(leftPad)}</Text>}
            {bold
              ? <Text bold><InlineTokens tokens={cell.tokens} /></Text>
              : <InlineTokens tokens={cell.tokens} />}
            {rightPad > 0 && <Text>{" ".repeat(rightPad)}</Text>}
            {ci < colWidths.length - 1 && <Text>{"  "}</Text>}
          </React.Fragment>
        );
      }
    }

    // Plain text fallback (handles truncation with "…")
    return (
      <React.Fragment key={ci}>
        {bold ? <Text bold>{padded}</Text> : <Text>{padded}</Text>}
        {ci < colWidths.length - 1 && <Text>{"  "}</Text>}
      </React.Fragment>
    );
  };

  const renderRow = (
    cells: Tokens.TableCell[],
    bold: boolean,
    key: string,
  ) => (
    <Box key={key}>
      {colWidths.map((w, ci) =>
        renderCell(cells[ci], w, ci, alignments[ci] ?? "left", bold)
      )}
    </Box>
  );

  return (
    <Box flexDirection="column" marginY={0}>
      {renderRow(token.header, true, "header")}
      <Box>
        <Text color={sc.text.muted}>{separator}</Text>
      </Box>
      {token.rows.map((row, ri) => renderRow(row, false, `row-${ri}`))}
    </Box>
  );
});

type SemanticColors = ReturnType<typeof useSemanticColors>;

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
          <CodeBlock code={t.text} language={t.lang} width={width} isPending={isPending} />
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
      return <InlineTokens tokens={t.tokens} />;
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
                <Text color={sc.text.muted}>{bullet} </Text>
                {hasBlockContent
                  ? (
                    <Box flexDirection="column">
                      {item.tokens!
                        .filter((s: Token) => s.type !== "checkbox")
                        .map((subToken: Token, si: number) => (
                          <React.Fragment key={si}>
                            {subToken.type === "text" && "tokens" in subToken &&
                                Array.isArray((subToken as Tokens.Text).tokens)
                              ? <InlineTokens tokens={(subToken as Tokens.Text).tokens!} />
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
                  <Text color={sc.text.secondary}>│ </Text>
                  <Box flexShrink={1}>
                    <InlineMarkdown text={line} />
                  </Box>
                </Box>
              ));
            }
            // Other block tokens get one prefix per block
            return [(
              <Box key={i}>
                <Text color={sc.text.secondary}>│ </Text>
                <Box flexShrink={1}>
                  {renderBlock(subToken, width - 2, sc, isPending)}
                </Box>
              </Box>
            )];
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
  const tokens = useMemo(() => marked.lexer(text), [text]);

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
