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

import { ANSI_COLORS } from "../ansi.ts";

const { BOLD, DIM_GRAY, CYAN, GREEN, RESET } = ANSI_COLORS;

// Additional ANSI codes
const ITALIC = "\x1b[3m";
const UNDERLINE = "\x1b[4m";

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

/**
 * Render markdown string to ANSI terminal output
 */
export function renderMarkdown(text: string, width = 80): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block start/end
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        result.push(`${DIM_GRAY}┌${"─".repeat(Math.min(width - 2, 60))}${RESET}`);
      } else {
        inCodeBlock = false;
        result.push(`${DIM_GRAY}└${"─".repeat(Math.min(width - 2, 60))}${RESET}`);
      }
      continue;
    }

    // Inside code block - render as-is with dim styling
    if (inCodeBlock) {
      result.push(`${DIM_GRAY}│${RESET} ${line}`);
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      result.push("");
      continue;
    }

    // Horizontal rule
    if (HORIZONTAL_RULE_REGEX.test(line.trim())) {
      result.push(`${DIM_GRAY}${"─".repeat(Math.min(width, 60))}${RESET}`);
      continue;
    }

    // Headers
    const headerMatch = line.match(HEADER_REGEX);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const content = headerMatch[2];
      const formatted = formatInline(content);

      if (level === 1) {
        result.push(`${BOLD}${CYAN}${formatted}${RESET}`);
        result.push(`${CYAN}${"═".repeat(Math.min(content.length, width))}${RESET}`);
      } else if (level === 2) {
        result.push(`${BOLD}${GREEN}${formatted}${RESET}`);
      } else {
        result.push(`${BOLD}${formatted}${RESET}`);
      }
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const content = line.slice(1).trim();
      const formatted = formatInline(content);
      const wrapped = wordWrap(`${DIM_GRAY}│${RESET} ${ITALIC}${formatted}${RESET}`, width - 4);
      result.push(...wrapped.map(l => `  ${l}`));
      continue;
    }

    // Unordered list
    const ulMatch = line.match(UL_REGEX);
    if (ulMatch) {
      const indent = ulMatch[1].length;
      const content = ulMatch[2];
      const formatted = formatInline(content);
      const bullet = indent > 0 ? "◦" : "•";
      const wrapped = wordWrap(formatted, width - indent - 4);
      result.push(`${" ".repeat(indent)}  ${CYAN}${bullet}${RESET} ${wrapped[0]}`);
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
      const formatted = formatInline(content);
      const wrapped = wordWrap(formatted, width - indent - 5);
      result.push(`${" ".repeat(indent)}  ${CYAN}${num}.${RESET} ${wrapped[0]}`);
      for (let j = 1; j < wrapped.length; j++) {
        result.push(`${" ".repeat(indent + 5)}${wrapped[j]}`);
      }
      continue;
    }

    // Regular paragraph - wrap and format inline
    const formatted = formatInline(line);
    const wrapped = wordWrap(formatted, width);
    result.push(...wrapped);
  }

  return result.join("\n");
}

/**
 * Format inline markdown (bold, italic, code, links)
 * Uses pre-compiled module-level regex patterns for performance
 */
function formatInline(text: string): string {
  let result = text;

  // Inline code (must be before bold/italic to avoid conflicts)
  result = result.replace(INLINE_CODE_REGEX, `${DIM_GRAY}$1${RESET}`);

  // Bold
  result = result.replace(BOLD_ASTERISK_REGEX, `${BOLD}$1${RESET}`);
  result = result.replace(BOLD_UNDERSCORE_REGEX, `${BOLD}$1${RESET}`);

  // Italic
  result = result.replace(ITALIC_ASTERISK_REGEX, `${ITALIC}$1${RESET}`);
  result = result.replace(ITALIC_UNDERSCORE_REGEX, `${ITALIC}$1${RESET}`);

  // Links [text](url) - show text in cyan, url in dim
  result = result.replace(LINK_REGEX, `${CYAN}${UNDERLINE}$1${RESET} ${DIM_GRAY}($2)${RESET}`);

  return result;
}

/**
 * Word wrap text to fit terminal width
 * Handles ANSI codes correctly (doesn't count them in width)
 */
function wordWrap(text: string, width: number): string[] {
  if (width <= 0) width = 80;

  // Strip ANSI codes for length calculation (uses module-level regex)
  const stripAnsi = (s: string) => s.replace(ANSI_STRIP_REGEX, "");

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
