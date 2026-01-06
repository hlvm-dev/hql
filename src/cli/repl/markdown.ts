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

/**
 * Render markdown string to ANSI terminal output
 */
export function renderMarkdown(text: string, width = 80): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;
  let _codeBlockLang = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block start/end
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        _codeBlockLang = line.slice(3).trim();
        result.push(`${DIM_GRAY}┌${"─".repeat(Math.min(width - 2, 60))}${RESET}`);
      } else {
        inCodeBlock = false;
        _codeBlockLang = "";
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
    if (/^[-*_]{3,}$/.test(line.trim())) {
      result.push(`${DIM_GRAY}${"─".repeat(Math.min(width, 60))}${RESET}`);
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
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
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
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
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
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
 */
function formatInline(text: string): string {
  let result = text;

  // Inline code (must be before bold/italic to avoid conflicts)
  result = result.replace(/`([^`]+)`/g, `${DIM_GRAY}$1${RESET}`);

  // Bold
  result = result.replace(/\*\*([^*]+)\*\*/g, `${BOLD}$1${RESET}`);
  result = result.replace(/__([^_]+)__/g, `${BOLD}$1${RESET}`);

  // Italic
  result = result.replace(/\*([^*]+)\*/g, `${ITALIC}$1${RESET}`);
  result = result.replace(/_([^_]+)_/g, `${ITALIC}$1${RESET}`);

  // Links [text](url) - show text in cyan, url in dim
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    `${CYAN}${UNDERLINE}$1${RESET} ${DIM_GRAY}($2)${RESET}`
  );

  return result;
}

/**
 * Word wrap text to fit terminal width
 * Handles ANSI codes correctly (doesn't count them in width)
 */
function wordWrap(text: string, width: number): string[] {
  if (width <= 0) width = 80;

  // Strip ANSI codes for length calculation
  // deno-lint-ignore no-control-regex
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

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

/**
 * Render a simple separator line
 */
export function renderSeparator(width = 60): string {
  return `${DIM_GRAY}${"─".repeat(width)}${RESET}`;
}

/**
 * Render an AI response with nice formatting
 * Adds a subtle header and renders markdown
 */
export function renderAIResponse(text: string, width = 80): string {
  const rendered = renderMarkdown(text, width);
  return rendered;
}

/**
 * Check if text looks like it contains markdown
 */
export function hasMarkdown(text: string): boolean {
  // Check for common markdown patterns
  return /^#+\s|```|\*\*|\*[^*]+\*|^[-*+]\s|^\d+\.\s|^>/m.test(text);
}
