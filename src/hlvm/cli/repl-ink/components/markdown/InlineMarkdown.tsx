import React, { memo } from "react";
import { Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";

type SegmentType = "plain" | "bold" | "italic" | "code" | "link" | "url";

interface InlineSegment {
  type: SegmentType;
  text: string;
}

interface InlineMarkdownProps {
  text: string;
}

const INLINE_PATTERN = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^\)]+\)|https?:\/\/\S+)/g;

function parseInline(text: string): InlineSegment[] {
  if (!text) return [];

  const segments: InlineSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0;
    const token = match[0];

    if (start > lastIndex) {
      segments.push({ type: "plain", text: text.slice(lastIndex, start) });
    }

    if (token.startsWith("**") && token.endsWith("**")) {
      segments.push({ type: "bold", text: token.slice(2, -2) });
    } else if (token.startsWith("*") && token.endsWith("*")) {
      segments.push({ type: "italic", text: token.slice(1, -1) });
    } else if (token.startsWith("`") && token.endsWith("`")) {
      segments.push({ type: "code", text: token.slice(1, -1) });
    } else if (token.startsWith("[") && token.includes("](")) {
      const closeBracket = token.indexOf("](");
      segments.push({ type: "link", text: token.slice(1, closeBracket) });
    } else {
      segments.push({ type: "url", text: token });
    }

    lastIndex = start + token.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "plain", text: text.slice(lastIndex) });
  }

  return segments;
}

export const InlineMarkdown = memo(function InlineMarkdown(
  { text }: InlineMarkdownProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const segments = parseInline(text);

  return (
    <Text wrap="wrap">
      {segments.map((segment: InlineSegment, index: number) => {
        if (segment.type === "bold") {
          return <React.Fragment key={index}><Text bold>{segment.text}</Text></React.Fragment>;
        }
        if (segment.type === "italic") {
          return <React.Fragment key={index}><Text dimColor>{segment.text}</Text></React.Fragment>;
        }
        if (segment.type === "code") {
          return <React.Fragment key={index}><Text color={sc.syntax.string}>{segment.text}</Text></React.Fragment>;
        }
        if (segment.type === "link" || segment.type === "url") {
          return <React.Fragment key={index}><Text color={sc.status.success}>{segment.text}</Text></React.Fragment>;
        }
        return <React.Fragment key={index}><Text>{segment.text}</Text></React.Fragment>;
      })}
    </Text>
  );
});
