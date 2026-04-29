import chalk from "chalk";
import { marked, type Token, type Tokens } from "marked";
import stripAnsi from "strip-ansi";
import { BLOCKQUOTE_BAR } from "./figures.ts";
import { stringWidth } from "../../utils/ansi/string-width.ts";
import { supportsHyperlinks } from "../../utils/ansi/supports-hyperlinks.ts";
import type { CliHighlight } from "./cliHighlight.ts";
import { createHyperlink } from "./hyperlink.ts";
import { stripPromptXMLTags } from "./messages.ts";

const EOL = "\n";
const INLINE_CODE_COLOR = chalk.cyan;

let markedConfigured = false;

export function configureMarked(): void {
  if (markedConfigured) return;
  markedConfigured = true;

  marked.use({
    tokenizer: {
      del() {
        return undefined;
      },
    },
  });
}

export function applyMarkdown(
  content: string,
  highlight: CliHighlight | null = null,
): string {
  configureMarked();
  return marked
    .lexer(stripPromptXMLTags(content))
    .map((token) => formatToken(token, 0, null, null, highlight))
    .join("")
    .trim();
}

export function formatToken(
  token: Token,
  listDepth = 0,
  orderedListNumber: number | null = null,
  parent: Token | null = null,
  highlight: CliHighlight | null = null,
): string {
  switch (token.type) {
    case "blockquote": {
      const inner = (token.tokens ?? [])
        .map((child) => formatToken(child, 0, null, null, highlight))
        .join("");
      const bar = chalk.dim(BLOCKQUOTE_BAR);
      return inner
        .split(EOL)
        .map((line) =>
          stripAnsi(line).trim() ? `${bar} ${chalk.italic(line)}` : line
        )
        .join(EOL);
    }
    case "code": {
      if (!highlight) {
        return token.text + EOL;
      }

      let language = "plaintext";
      if (token.lang && highlight.supportsLanguage(token.lang)) {
        language = token.lang;
      }
      return highlight.highlight(token.text, { language }) + EOL;
    }
    case "codespan":
      return INLINE_CODE_COLOR(token.text);
    case "em":
      return chalk.italic(
        (token.tokens ?? [])
          .map((child) => formatToken(child, 0, null, parent, highlight))
          .join(""),
      );
    case "strong":
      return chalk.bold(
        (token.tokens ?? [])
          .map((child) => formatToken(child, 0, null, parent, highlight))
          .join(""),
      );
    case "heading":
      switch (token.depth) {
        case 1:
          return chalk.bold.italic.underline(
            (token.tokens ?? [])
              .map((child) => formatToken(child, 0, null, null, highlight))
              .join(""),
          ) + EOL + EOL;
        default:
          return chalk.bold(
            (token.tokens ?? [])
              .map((child) => formatToken(child, 0, null, null, highlight))
              .join(""),
          ) + EOL + EOL;
      }
    case "hr":
      return "---";
    case "image":
      return token.href;
    case "link": {
      if (token.href.startsWith("mailto:")) {
        return token.href.replace(/^mailto:/, "");
      }

      const linkText = (token.tokens ?? [])
        .map((child) => formatToken(child, 0, null, token, highlight))
        .join("");
      const plainLinkText = stripAnsi(linkText);
      if (plainLinkText && plainLinkText !== token.href) {
        return createHyperlink(token.href, linkText);
      }
      return createHyperlink(token.href);
    }
    case "list":
      return token.items
        .map((item: Tokens.ListItem, index: number) =>
          formatToken(
            item,
            listDepth,
            token.ordered ? token.start + index : null,
            token,
            highlight,
          )
        )
        .join("");
    case "list_item":
      return (token.tokens ?? [])
        .map((child) =>
          `${"  ".repeat(listDepth)}${
            formatToken(
              child,
              listDepth + 1,
              orderedListNumber,
              token,
              highlight,
            )
          }`
        )
        .join("");
    case "paragraph":
      return (token.tokens ?? [])
        .map((child) => formatToken(child, 0, null, null, highlight))
        .join("") + EOL;
    case "space":
    case "br":
      return EOL;
    case "text":
      if (parent?.type === "link") {
        return token.text;
      }
      if (parent?.type === "list_item") {
        return `${
          orderedListNumber === null
            ? "-"
            : `${getListNumber(listDepth, orderedListNumber)}.`
        } ${
          token.tokens
            ? token.tokens.map((child) =>
              formatToken(child, listDepth, orderedListNumber, token, highlight)
            ).join("")
            : linkifyIssueReferences(token.text)
        }${EOL}`;
      }
      return linkifyIssueReferences(token.text);
    case "table": {
      const tableToken = token as Tokens.Table;
      function getDisplayText(tokens: Token[] | undefined): string {
        return stripAnsi(
          tokens?.map((child) => formatToken(child, 0, null, null, highlight))
            .join("") ?? "",
        );
      }

      const columnWidths = tableToken.header.map((header, index) => {
        let maxWidth = stringWidth(getDisplayText(header.tokens));
        for (const row of tableToken.rows) {
          const cellLength = stringWidth(getDisplayText(row[index]?.tokens));
          maxWidth = Math.max(maxWidth, cellLength);
        }
        return Math.max(maxWidth, 3);
      });

      let tableOutput = "| ";
      tableToken.header.forEach((header, index) => {
        const content = header.tokens?.map((child) =>
          formatToken(child, 0, null, null, highlight)
        ).join("") ?? "";
        const displayText = getDisplayText(header.tokens);
        const width = columnWidths[index]!;
        const align = tableToken.align?.[index];
        tableOutput +=
          padAligned(content, stringWidth(displayText), width, align) + " | ";
      });
      tableOutput = tableOutput.trimEnd() + EOL;

      tableOutput += "|";
      columnWidths.forEach((width) => {
        tableOutput += "-".repeat(width + 2) + "|";
      });
      tableOutput += EOL;

      tableToken.rows.forEach((row) => {
        tableOutput += "| ";
        row.forEach((cell, index) => {
          const content = cell.tokens?.map((child) =>
            formatToken(child, 0, null, null, highlight)
          ).join("") ?? "";
          const displayText = getDisplayText(cell.tokens);
          const width = columnWidths[index]!;
          const align = tableToken.align?.[index];
          tableOutput +=
            padAligned(content, stringWidth(displayText), width, align) + " | ";
        });
        tableOutput = tableOutput.trimEnd() + EOL;
      });

      return tableOutput + EOL;
    }
    case "escape":
      return token.text;
    case "def":
    case "del":
    case "html":
      return "";
  }

  return "";
}

const ISSUE_REF_PATTERN =
  /(^|[^\w./-])([A-Za-z0-9][\w-]*\/[A-Za-z0-9][\w.-]*)#(\d+)\b/g;

function linkifyIssueReferences(text: string): string {
  if (!supportsHyperlinks()) {
    return text;
  }

  return text.replace(
    ISSUE_REF_PATTERN,
    (_match, prefix, repo, num) =>
      prefix +
      createHyperlink(
        `https://github.com/${repo}/issues/${num}`,
        `${repo}#${num}`,
      ),
  );
}

function numberToLetter(n: number): string {
  let result = "";
  while (n > 0) {
    n--;
    result = String.fromCharCode(97 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

const ROMAN_VALUES: ReadonlyArray<[number, string]> = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

function numberToRoman(n: number): string {
  let result = "";
  for (const [value, numeral] of ROMAN_VALUES) {
    while (n >= value) {
      result += numeral;
      n -= value;
    }
  }
  return result;
}

function getListNumber(listDepth: number, orderedListNumber: number): string {
  switch (listDepth) {
    case 0:
    case 1:
      return orderedListNumber.toString();
    case 2:
      return numberToLetter(orderedListNumber);
    case 3:
      return numberToRoman(orderedListNumber);
    default:
      return orderedListNumber.toString();
  }
}

export function padAligned(
  content: string,
  displayWidth: number,
  targetWidth: number,
  align: "left" | "center" | "right" | null | undefined,
): string {
  const padding = Math.max(0, targetWidth - displayWidth);
  if (align === "center") {
    const leftPad = Math.floor(padding / 2);
    return " ".repeat(leftPad) + content + " ".repeat(padding - leftPad);
  }
  if (align === "right") {
    return " ".repeat(padding) + content;
  }
  return content + " ".repeat(padding);
}
