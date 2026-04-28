// @ts-nocheck
import { marked, type Token, type Tokens } from "marked";
import React, { Suspense, use, useMemo, useRef } from "react";
import { Ansi } from "../../../../vendor/ink/Ansi.tsx";
import Box from "../../../../vendor/ink/components/Box.tsx";
import { getCliHighlightPromise } from "./cliHighlight.ts";
import type { CliHighlight } from "./cliHighlight.ts";
import { hashContent } from "../../utils/hash.ts";
import { configureMarked, formatToken } from "./markdown.ts";
import { stripPromptXMLTags } from "./messages.ts";
import { MarkdownTable } from "./MarkdownTable.tsx";

type Props = {
  children: string;
  dimColor?: boolean;
};

const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map<string, Token[]>();
const MD_SYNTAX_RE = /[#*`|[>\-_~]|\n\n|^\d+\. |\n\d+\. /;

function hasMarkdownSyntax(s: string): boolean {
  return MD_SYNTAX_RE.test(s.length > 500 ? s.slice(0, 500) : s);
}

function cachedLexer(content: string): Token[] {
  if (!hasMarkdownSyntax(content)) {
    return [{
      type: "paragraph",
      raw: content,
      text: content,
      tokens: [{ type: "text", raw: content, text: content }],
    } as Token];
  }

  const key = hashContent(content);
  const hit = tokenCache.get(key);
  if (hit) {
    tokenCache.delete(key);
    tokenCache.set(key, hit);
    return hit;
  }

  const tokens = marked.lexer(content);
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const first = tokenCache.keys().next().value;
    if (first !== undefined) tokenCache.delete(first);
  }
  tokenCache.set(key, tokens);
  return tokens;
}

export function Markdown(props: Props) {
  return (
    <Suspense fallback={<MarkdownBody {...props} highlight={null} />}>
      <MarkdownWithHighlight {...props} />
    </Suspense>
  );
}

function MarkdownWithHighlight(props: Props) {
  const highlight = use(getCliHighlightPromise());
  return <MarkdownBody {...props} highlight={highlight} />;
}

function MarkdownBody({
  children,
  dimColor,
  highlight,
}: Props & { highlight: CliHighlight | null }) {
  configureMarked();

  const elements = useMemo(() => {
    const tokens = cachedLexer(stripPromptXMLTags(children));
    const output: React.ReactNode[] = [];
    let nonTableContent = "";

    const flushNonTableContent = () => {
      if (!nonTableContent) return;
      output.push(
        <Ansi key={output.length} dimColor={dimColor}>
          {nonTableContent.trim()}
        </Ansi>,
      );
      nonTableContent = "";
    };

    for (const token of tokens) {
      if (token.type === "table") {
        flushNonTableContent();
        output.push(
          <MarkdownTable
            key={output.length}
            token={token as Tokens.Table}
            highlight={highlight}
          />,
        );
      } else {
        nonTableContent += formatToken(token, 0, null, null, highlight);
      }
    }

    flushNonTableContent();
    return output;
  }, [children, dimColor, highlight]);

  return <Box flexDirection="column" gap={1}>{elements}</Box>;
}

type StreamingProps = {
  children: string;
};

export function StreamingMarkdown(
  { children }: StreamingProps,
): React.ReactNode {
  configureMarked();

  const stripped = stripPromptXMLTags(children);
  const stablePrefixRef = useRef("");

  if (!stripped.startsWith(stablePrefixRef.current)) {
    stablePrefixRef.current = "";
  }

  const boundary = stablePrefixRef.current.length;
  const tokens = marked.lexer(stripped.substring(boundary));

  let lastContentIdx = tokens.length - 1;
  while (lastContentIdx >= 0 && tokens[lastContentIdx]!.type === "space") {
    lastContentIdx--;
  }

  let advance = 0;
  for (let i = 0; i < lastContentIdx; i++) {
    advance += tokens[i]!.raw.length;
  }
  if (advance > 0) {
    stablePrefixRef.current = stripped.substring(0, boundary + advance);
  }

  const stablePrefix = stablePrefixRef.current;
  const unstableSuffix = stripped.substring(stablePrefix.length);

  return (
    <Box flexDirection="column" gap={1}>
      {stablePrefix && <Markdown children={stablePrefix} />}
      {unstableSuffix && <Markdown children={unstableSuffix} />}
    </Box>
  );
}
