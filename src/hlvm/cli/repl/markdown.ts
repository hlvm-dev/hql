/**
 * Markdown Detection Utility
 *
 * Detects whether text contains markdown formatting.
 * Used to decide when to render text as markdown vs plain text.
 */

// Pattern for detecting markdown content (pre-compiled for hasMarkdown hot path)
const MARKDOWN_DETECT_REGEX = /^#+\s|```|\*\*|\*[^*]+\*|^[-*+]\s|^\d+\.\s|^>/m;

/**
 * Check if text looks like it contains markdown
 */
export function hasMarkdown(text: string): boolean {
  // Check for common markdown patterns (uses pre-compiled module-level regex)
  return MARKDOWN_DETECT_REGEX.test(text);
}
