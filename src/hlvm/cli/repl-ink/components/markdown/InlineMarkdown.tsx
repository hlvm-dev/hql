import React, { memo } from "react";
import { Text } from "ink";
import { marked, type Token, type Tokens } from "marked";
import { useSemanticColors } from "../../../theme/index.ts";

interface InlineTokensProps {
  tokens: Token[];
}

/**
 * Renders an array of marked inline tokens recursively.
 * This is the primary inline renderer — block-level components pass
 * pre-parsed token arrays directly (no re-parsing).
 */
export const InlineTokens = memo(function InlineTokens(
  { tokens }: InlineTokensProps,
): React.ReactElement {
  const sc = useSemanticColors();

  return (
    <Text wrap="wrap">
      {tokens.map((token: Token, index: number) => {
        switch (token.type) {
          case "strong":
            return (
              <React.Fragment key={index}>
                <Text bold>
                  <InlineTokens tokens={(token as Tokens.Strong).tokens} />
                </Text>
              </React.Fragment>
            );
          case "em":
            return (
              <React.Fragment key={index}>
                <Text dimColor>
                  <InlineTokens tokens={(token as Tokens.Em).tokens} />
                </Text>
              </React.Fragment>
            );
          case "codespan":
            return (
              <React.Fragment key={index}>
                <Text color={sc.syntax.string}>
                  {(token as Tokens.Codespan).text}
                </Text>
              </React.Fragment>
            );
          case "link":
            return (
              <React.Fragment key={index}>
                <Text color={sc.status.success}>
                  {(token as Tokens.Link).text}
                </Text>
              </React.Fragment>
            );
          case "del":
            return (
              <React.Fragment key={index}>
                <Text strikethrough>
                  <InlineTokens tokens={(token as Tokens.Del).tokens} />
                </Text>
              </React.Fragment>
            );
          case "br":
            return <React.Fragment key={index}>{"\n"}</React.Fragment>;
          case "escape":
            return (
              <React.Fragment key={index}>
                <Text>{(token as Tokens.Escape).text}</Text>
              </React.Fragment>
            );
          default:
            // "text" and any unknown token — render raw text
            return (
              <React.Fragment key={index}>
                <Text>{"text" in token ? (token as Tokens.Text).text : String(token.raw ?? "")}</Text>
              </React.Fragment>
            );
        }
      })}
    </Text>
  );
});

interface InlineMarkdownProps {
  text: string;
}

/**
 * Backward-compat wrapper: accepts a raw markdown string, lexes it inline,
 * then delegates to InlineTokens.
 */
export const InlineMarkdown = memo(function InlineMarkdown(
  { text }: InlineMarkdownProps,
): React.ReactElement {
  if (!text) return <Text />;
  const tokens = marked.Lexer.lexInline(text);
  return <InlineTokens tokens={tokens} />;
});
