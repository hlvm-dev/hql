/**
 * Regression tests for the marked-based markdown renderer.
 *
 * Tests verify:
 * 1. marked.lexer() token shapes match our rendering assumptions
 * 2. Helper functions (visibleLength, alignCell) work correctly
 * 3. List item inline tokens are accessible for rendering
 * 4. Table cell tokens with inline formatting have correct structure
 * 5. Task lists, nested formatting, and edge cases
 */

import { assertEquals, assert } from "jsr:@std/assert@1";
import { marked, type Token, type Tokens } from "marked";

// ──────────────────────────────────────────────────────────────────────
// Helper function tests (reimplemented here since they're not exported)
// ──────────────────────────────────────────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function visibleLength(text: string): number {
  return stripMarkdown(text).length;
}

function alignCell(
  text: string,
  width: number,
  alignment: "left" | "center" | "right",
): string {
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

/** Extract inline tokens from a list item (mirrors renderBlock logic). */
function extractListItemInlineTokens(item: Tokens.ListItem): Token[] {
  const inlineTokens: Token[] = [];
  if (item.tokens) {
    for (const sub of item.tokens) {
      if (sub.type === "checkbox") continue;
      if (
        sub.type === "text" && "tokens" in sub &&
        Array.isArray((sub as Tokens.Text).tokens)
      ) {
        inlineTokens.push(...(sub as Tokens.Text).tokens!);
      } else {
        inlineTokens.push(sub);
      }
    }
  }
  return inlineTokens;
}

// ──────────────────────────────────────────────────────────────────────
// visibleLength
// ──────────────────────────────────────────────────────────────────────

Deno.test("visibleLength strips bold markers", () => {
  assertEquals(visibleLength("**Tesla**"), 5);
});

Deno.test("visibleLength strips italic markers", () => {
  assertEquals(visibleLength("*italic*"), 6);
});

Deno.test("visibleLength strips inline code backticks", () => {
  assertEquals(visibleLength("`code`"), 4);
});

Deno.test("visibleLength strips link syntax to display text only", () => {
  assertEquals(visibleLength("[click here](http://example.com)"), 10);
});

Deno.test("visibleLength strips strikethrough markers", () => {
  assertEquals(visibleLength("~~deleted~~"), 7);
});

Deno.test("visibleLength handles mixed formatting", () => {
  assertEquals(visibleLength("**bold** and `code`"), 13);
});

Deno.test("visibleLength returns plain text length unchanged", () => {
  assertEquals(visibleLength("hello world"), 11);
});

// ──────────────────────────────────────────────────────────────────────
// alignCell
// ──────────────────────────────────────────────────────────────────────

Deno.test("alignCell left-pads text for left alignment", () => {
  assertEquals(alignCell("hi", 6, "left"), "hi    ");
});

Deno.test("alignCell right-pads text for right alignment", () => {
  assertEquals(alignCell("hi", 6, "right"), "    hi");
});

Deno.test("alignCell centers text", () => {
  assertEquals(alignCell("hi", 6, "center"), "  hi  ");
});

Deno.test("alignCell truncates with ellipsis when text exceeds width", () => {
  const result = alignCell("very long text", 5, "left");
  assertEquals(result, "very…");
});

Deno.test("alignCell uses visible length for bold text", () => {
  // "**bold**" has visible length 4, should fit in width 6 with 2 padding
  const result = alignCell("**bold**", 6, "left");
  assertEquals(result, "**bold**  ");
});

// ──────────────────────────────────────────────────────────────────────
// marked.lexer() token shape: List items with inline formatting
// ──────────────────────────────────────────────────────────────────────

Deno.test("list item with bold has nested inline tokens", () => {
  const tokens = marked.lexer("- **bold** item");
  const list = tokens.find((t) => t.type === "list") as Tokens.List;
  assert(list, "should produce a list token");
  assertEquals(list.items.length, 1);

  const item = list.items[0];
  const inlineTokens = extractListItemInlineTokens(item);
  const strongToken = inlineTokens.find((t) => t.type === "strong");
  assert(strongToken, "should contain a strong token");
  assertEquals((strongToken as Tokens.Strong).text, "bold");
});

Deno.test("list item with code has nested codespan token", () => {
  const tokens = marked.lexer("- `code` here");
  const list = tokens.find((t) => t.type === "list") as Tokens.List;
  const item = list.items[0];
  const inlineTokens = extractListItemInlineTokens(item);
  const codeToken = inlineTokens.find((t) => t.type === "codespan");
  assert(codeToken, "should contain a codespan token");
  assertEquals((codeToken as Tokens.Codespan).text, "code");
});

Deno.test("list item with link has nested link token", () => {
  const tokens = marked.lexer("- [click](http://example.com)");
  const list = tokens.find((t) => t.type === "list") as Tokens.List;
  const item = list.items[0];
  const inlineTokens = extractListItemInlineTokens(item);
  const linkToken = inlineTokens.find((t) => t.type === "link");
  assert(linkToken, "should contain a link token");
  assertEquals((linkToken as Tokens.Link).text, "click");
});

Deno.test("task list items have checked property and checkbox tokens", () => {
  const tokens = marked.lexer("- [ ] unchecked\n- [x] checked");
  const list = tokens.find((t) => t.type === "list") as Tokens.List;
  assertEquals(list.items.length, 2);

  assertEquals(list.items[0].checked, false);
  assertEquals(list.items[1].checked, true);

  // Checkbox tokens should be filtered out by extractListItemInlineTokens
  const inline0 = extractListItemInlineTokens(list.items[0]);
  const checkboxes0 = inline0.filter((t) => t.type === "checkbox");
  assertEquals(checkboxes0.length, 0, "checkbox should be filtered out");

  // Should still have text content
  const textTokens0 = inline0.filter((t) => t.type === "text");
  assert(textTokens0.length > 0, "should have text content after checkbox");
});

// ──────────────────────────────────────────────────────────────────────
// marked.lexer() token shape: Tables with inline formatting
// ──────────────────────────────────────────────────────────────────────

Deno.test("table cells with bold have inline tokens", () => {
  const md = "| Name | Value |\n| --- | --- |\n| **Tesla** | 100 |";
  const tokens = marked.lexer(md);
  const table = tokens.find((t) => t.type === "table") as Tokens.Table;
  assert(table, "should produce a table token");

  // First data row, first cell
  const cell = table.rows[0][0];
  assertEquals(cell.text, "**Tesla**");
  assert(cell.tokens.length > 0, "cell should have inline tokens");
  const strong = cell.tokens.find((t: Token) => t.type === "strong");
  assert(strong, "cell should contain a strong token");
});

Deno.test("table alignment is parsed correctly", () => {
  const md =
    "| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |";
  const tokens = marked.lexer(md);
  const table = tokens.find((t) => t.type === "table") as Tokens.Table;
  assertEquals(table.align, ["left", "center", "right"]);
});

// ──────────────────────────────────────────────────────────────────────
// marked.lexer() token shape: Nested inline formatting
// ──────────────────────────────────────────────────────────────────────

Deno.test("nested bold-italic produces nested token tree", () => {
  const tokens = marked.Lexer.lexInline("**bold *italic* inside**");
  const strong = tokens.find((t) => t.type === "strong") as Tokens.Strong;
  assert(strong, "should have a strong token");
  assert(strong.tokens.length > 0, "strong should have nested tokens");
  const em = strong.tokens.find((t: Token) => t.type === "em");
  assert(em, "strong should contain an em token for nested italic");
});

// ──────────────────────────────────────────────────────────────────────
// marked.lexer() token shape: Block-level tokens
// ──────────────────────────────────────────────────────────────────────

Deno.test("code block produces code token with language", () => {
  const tokens = marked.lexer("```typescript\nconst x = 1;\n```");
  const code = tokens.find((t) => t.type === "code") as Tokens.Code;
  assert(code, "should produce a code token");
  assertEquals(code.lang, "typescript");
  assertEquals(code.text, "const x = 1;");
});

Deno.test("heading produces heading token with depth and inline tokens", () => {
  const tokens = marked.lexer("## Hello **world**");
  const heading = tokens.find((t) => t.type === "heading") as Tokens.Heading;
  assert(heading, "should produce a heading token");
  assertEquals(heading.depth, 2);
  assert(heading.tokens.length > 0, "heading should have inline tokens");
  const strong = heading.tokens.find((t: Token) => t.type === "strong");
  assert(strong, "heading should contain bold formatting");
});

Deno.test("blockquote produces blockquote token with nested content", () => {
  const tokens = marked.lexer("> quoted text");
  const bq = tokens.find((t) => t.type === "blockquote") as Tokens.Blockquote;
  assert(bq, "should produce a blockquote token");
  assert(bq.tokens.length > 0, "blockquote should have nested tokens");
});

Deno.test("horizontal rule produces hr token", () => {
  const tokens = marked.lexer("---");
  const hr = tokens.find((t) => t.type === "hr");
  assert(hr, "should produce an hr token");
});

// ──────────────────────────────────────────────────────────────────────
// marked.lexer() streaming: partial/unclosed content
// ──────────────────────────────────────────────────────────────────────

Deno.test("unclosed code block still produces a code token", () => {
  const tokens = marked.lexer("```python\nprint('hello')");
  const code = tokens.find((t) => t.type === "code") as Tokens.Code;
  assert(code, "unclosed code block should still produce a code token");
  assertEquals(code.text, "print('hello')");
});

Deno.test("partial table produces a table token", () => {
  const tokens = marked.lexer("| A | B |\n| --- | --- |\n| 1 | 2 |");
  const table = tokens.find((t) => t.type === "table") as Tokens.Table;
  assert(table, "should produce a table token");
  assertEquals(table.rows.length, 1);
});

// ──────────────────────────────────────────────────────────────────────
// Table cell truncation: visible > column width
// ──────────────────────────────────────────────────────────────────────

Deno.test("alignCell truncates bold text correctly when exceeding width", () => {
  // "**very long bold text**" has visible length 20, should truncate at width 8
  const result = alignCell("**very long bold text**", 8, "left");
  // visibleLength is 20 > 8, so it should truncate
  assert(result.length <= 10, "truncated result should be short");
  assert(result.endsWith("…"), "truncated result should end with ellipsis");
});

Deno.test("ordered list numbering starts from correct value", () => {
  const tokens = marked.lexer("3. third\n4. fourth");
  const list = tokens.find((t) => t.type === "list") as Tokens.List;
  assert(list, "should produce a list token");
  assert(list.ordered, "should be ordered");
  assertEquals(Number(list.start), 3);
});

// ──────────────────────────────────────────────────────────────────────
// Fix 1: Mixed list items — text sub-tokens in hasBlockContent path
// ──────────────────────────────────────────────────────────────────────

Deno.test("mixed list item: text sub-token has inline tokens for block path", () => {
  // "- **bold** parent\n  - nested child" produces a list item with both
  // a text sub-token (inline) and a list sub-token (block)
  const tokens = marked.lexer("- **bold** parent\n  - nested child");
  const list = tokens.find((t) => t.type === "list") as Tokens.List;
  assert(list, "should produce a list token");

  const item = list.items[0];
  assert(item.tokens, "item should have sub-tokens");

  // Should have both text and list sub-tokens (hasBlockContent = true)
  const textSub = item.tokens!.find((s) => s.type === "text");
  const listSub = item.tokens!.find((s) => s.type === "list");
  assert(textSub, "should have a text sub-token");
  assert(listSub, "should have a list sub-token (nested)");

  // The text sub-token should have inline tokens with strong formatting
  assert(
    "tokens" in textSub! && Array.isArray((textSub as Tokens.Text).tokens),
    "text sub-token should have inline tokens array",
  );
  const inlineTokens = (textSub as Tokens.Text).tokens!;
  const strongToken = inlineTokens.find((t: Token) => t.type === "strong");
  assert(strongToken, "text sub-token inline tokens should contain strong");
  assertEquals((strongToken as Tokens.Strong).text, "bold");
});

// ──────────────────────────────────────────────────────────────────────
// Fix 2: stripMarkdown + table cell truncation
// ──────────────────────────────────────────────────────────────────────

Deno.test("stripMarkdown removes bold markers", () => {
  assertEquals(stripMarkdown("**very long bold text**"), "very long bold text");
});

Deno.test("stripMarkdown removes mixed formatting", () => {
  assertEquals(stripMarkdown("**bold** and *italic* `code`"), "bold and italic code");
});

Deno.test("alignCell truncates bold text to clean visible text", () => {
  // "**very long bold text**" visible=20, width=8 → strip then truncate
  const result = alignCell("**very long bold text**", 8, "left");
  assertEquals(result, "very lo…");
  // Should NOT contain markdown markers like "**"
  assert(!result.includes("**"), "truncated result should not contain markdown markers");
});

Deno.test("alignCell truncates link syntax to clean text", () => {
  const result = alignCell("[very long link text](http://example.com)", 8, "left");
  assertEquals(result, "very lo…");
  assert(!result.includes("["), "should not contain link brackets");
});

// ──────────────────────────────────────────────────────────────────────
// Fix 3: Multi-line blockquote paragraph splitting
// ──────────────────────────────────────────────────────────────────────

Deno.test("multi-line blockquote paragraph preserves newlines in text", () => {
  const tokens = marked.lexer("> line one\n> line two\n> line three");
  const bq = tokens.find((t) => t.type === "blockquote") as Tokens.Blockquote;
  assert(bq, "should produce a blockquote token");

  // Should have a single paragraph sub-token with newlines preserved
  const para = bq.tokens.find((t: Token) => t.type === "paragraph") as Tokens.Paragraph;
  assert(para, "blockquote should contain a paragraph");

  const lines = para.text.split("\n");
  assertEquals(lines.length, 3, "paragraph text should have 3 lines");
  assertEquals(lines[0], "line one");
  assertEquals(lines[1], "line two");
  assertEquals(lines[2], "line three");
});
