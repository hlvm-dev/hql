import React, { memo } from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { CodeBlock } from "./CodeBlock.tsx";
import { InlineMarkdown } from "./InlineMarkdown.tsx";

type Block =
  | { type: "code"; language?: string; content: string; incomplete?: boolean }
  | { type: "heading"; level: number; content: string }
  | { type: "list"; bullet: string; indent: number; content: string }
  | { type: "quote"; content: string }
  | { type: "hr" }
  | { type: "paragraph"; content: string };

interface MarkdownDisplayProps {
  text: string;
  width: number;
  isPending?: boolean;
}

function isSpecialLine(line: string): boolean {
  return /^```/.test(line) || /^#{1,4}\s+/.test(line) || /^(\s*)([-*+]|\d+\.)\s+/.test(line) ||
    /^>\s?/.test(line) || /^-{3,}\s*$/.test(line);
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

        return (
          <InlineMarkdown key={index} text={block.content} />
        );
      })}
    </Box>
  );
});
