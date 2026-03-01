/**
 * Terminal Markdown Renderer
 *
 * Renders markdown to ANSI-formatted terminal output.
 * Designed for AI responses - readable, colorful, but not overwhelming.
 *
 * Supports:
 * - Headers (# ## ###)
 * - Bold (**text**)
 * - Italic (*text*)
 * - Code (`inline` and ```blocks```)
 * - Lists (- and 1.)
 * - Blockquotes (>)
 * - Horizontal rules (---)
 * - Word wrapping
 */

import { getThemedAnsi } from "../theme/index.ts";

// Additional ANSI codes
const BOLD = "\x1b[1m";
const ITALIC = "\x1b[3m";
const UNDERLINE = "\x1b[4m";
const RESET = "\x1b[0m";

// Pre-compiled regex patterns for performance (avoid compilation on each call)
const HORIZONTAL_RULE_REGEX = /^[-*_]{3,}$/;
const HEADER_REGEX = /^(#{1,6})\s+(.+)$/;
const UL_REGEX = /^(\s*)[-*+]\s+(.+)$/;
const OL_REGEX = /^(\s*)(\d+)\.\s+(.+)$/;
// deno-lint-ignore no-control-regex
const ANSI_STRIP_REGEX = /\x1b\[[0-9;]*m/g;

// Inline formatting patterns (pre-compiled for formatInline hot path)
const INLINE_CODE_REGEX = /`([^`]+)`/g;
const BOLD_ASTERISK_REGEX = /\*\*([^*]+)\*\*/g;
const BOLD_UNDERSCORE_REGEX = /__([^_]+)__/g;
const ITALIC_ASTERISK_REGEX = /\*([^*]+)\*/g;
const ITALIC_UNDERSCORE_REGEX = /_([^_]+)_/g;
const LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g;

/** Strip ANSI codes for length calculation */
const stripAnsi = (s: string) => s.replace(ANSI_STRIP_REGEX, "");

/**
 * Render markdown string to ANSI terminal output
 */
export function renderMarkdown(text: string, width = 80): string {
  const t = getThemedAnsi();
  const lines = text.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;
  const codeBlockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block start/end
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLines.length = 0;
      } else {
        inCodeBlock = false;
        // Render closed code box
        const boxWidth = Math.min(width, 62);
        const innerWidth = boxWidth - 4; // 2 border chars + 2 padding spaces
        result.push(`${t.muted}\u250c${"\u2500".repeat(boxWidth - 2)}\u2510${RESET}`);
        for (const codeLine of codeBlockLines) {
          const visible = stripAnsi(codeLine);
          const padLen = Math.max(0, innerWidth - visible.length);
          result.push(`${t.muted}\u2502${RESET} ${codeLine}${" ".repeat(padLen)} ${t.muted}\u2502${RESET}`);
        }
        result.push(`${t.muted}\u2514${"\u2500".repeat(boxWidth - 2)}\u2518${RESET}`);
      }
      continue;
    }

    // Inside code block - accumulate lines
    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      result.push("");
      continue;
    }

    // Horizontal rule
    if (HORIZONTAL_RULE_REGEX.test(line.trim())) {
      result.push(`${t.muted}${"\u2500".repeat(Math.min(width, 60))}${RESET}`);
      continue;
    }

    // Headers
    const headerMatch = line.match(HEADER_REGEX);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const content = headerMatch[2];
      const formatted = formatInline(content, t);

      if (level === 1) {
        result.push(`${BOLD}${t.primary}${formatted}${RESET}`);
        result.push(`${t.primary}${"\u2550".repeat(Math.min(content.length, width))}${RESET}`);
      } else if (level === 2) {
        result.push(`${BOLD}${t.secondary}${formatted}${RESET}`);
      } else {
        result.push(`${BOLD}${formatted}${RESET}`);
      }
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const content = line.slice(1).trim();
      const formatted = formatInline(content, t);
      const wrapped = wordWrap(`${t.muted}\u2502${RESET} ${ITALIC}${formatted}${RESET}`, width - 4);
      result.push(...wrapped.map(l => `  ${l}`));
      continue;
    }

    // Unordered list
    const ulMatch = line.match(UL_REGEX);
    if (ulMatch) {
      const indent = ulMatch[1].length;
      const content = ulMatch[2];
      const formatted = formatInline(content, t);
      const bullet = indent > 0 ? "\u25e6" : "\u2022";
      const wrapped = wordWrap(formatted, width - indent - 4);
      result.push(`${" ".repeat(indent)}  ${t.secondary}${bullet}${RESET} ${wrapped[0]}`);
      for (let j = 1; j < wrapped.length; j++) {
        result.push(`${" ".repeat(indent + 4)}${wrapped[j]}`);
      }
      continue;
    }

    // Ordered list
    const olMatch = line.match(OL_REGEX);
    if (olMatch) {
      const indent = olMatch[1].length;
      const num = olMatch[2];
      const content = olMatch[3];
      const formatted = formatInline(content, t);
      const wrapped = wordWrap(formatted, width - indent - 5);
      result.push(`${" ".repeat(indent)}  ${t.secondary}${num}.${RESET} ${wrapped[0]}`);
      for (let j = 1; j < wrapped.length; j++) {
        result.push(`${" ".repeat(indent + 5)}${wrapped[j]}`);
      }
      continue;
    }

    // Regular paragraph - wrap and format inline
    const formatted = formatInline(line, t);
    const wrapped = wordWrap(formatted, width);
    result.push(...wrapped);
  }

  return result.join("\n");
}

/**
 * Format inline markdown (bold, italic, code, links)
 * Uses pre-compiled module-level regex patterns for performance
 */
function formatInline(text: string, t: ReturnType<typeof getThemedAnsi>): string {
  let result = text;

  // Inline code (must be before bold/italic to avoid conflicts)
  result = result.replace(INLINE_CODE_REGEX, `${t.accent}$1${RESET}`);

  // Bold
  result = result.replace(BOLD_ASTERISK_REGEX, `${BOLD}$1${RESET}`);
  result = result.replace(BOLD_UNDERSCORE_REGEX, `${BOLD}$1${RESET}`);

  // Italic
  result = result.replace(ITALIC_ASTERISK_REGEX, `${ITALIC}$1${RESET}`);
  result = result.replace(ITALIC_UNDERSCORE_REGEX, `${ITALIC}$1${RESET}`);

  // Links [text](url) - show text in accent, url in muted
  result = result.replace(LINK_REGEX, `${t.accent}${UNDERLINE}$1${RESET} ${t.muted}($2)${RESET}`);

  return result;
}

/**
 * Word wrap text to fit terminal width
 * Handles ANSI codes correctly (doesn't count them in width)
 */
function wordWrap(text: string, width: number): string[] {
  if (width <= 0) width = 80;

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";
  let currentLength = 0;

  for (const word of words) {
    const wordLength = stripAnsi(word).length;

    if (currentLength + wordLength + 1 > width && currentLine !== "") {
      lines.push(currentLine);
      currentLine = word;
      currentLength = wordLength;
    } else {
      if (currentLine !== "") {
        currentLine += " ";
        currentLength += 1;
      }
      currentLine += word;
      currentLength += wordLength;
    }
  }

  if (currentLine !== "") {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [""];
}

// Pattern for detecting markdown content (pre-compiled for hasMarkdown hot path)
const MARKDOWN_DETECT_REGEX = /^#+\s|```|\*\*|\*[^*]+\*|^[-*+]\s|^\d+\.\s|^>/m;

/**
 * Check if text looks like it contains markdown
 */
export function hasMarkdown(text: string): boolean {
  // Check for common markdown patterns (uses pre-compiled module-level regex)
  return MARKDOWN_DETECT_REGEX.test(text);
}
