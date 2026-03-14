/**
 * Markdown-aware text splitting for progressive streaming.
 *
 * Finds safe paragraph boundaries to split growing streaming text
 * so that completed blocks can move to <Static> (rendered once).
 */

/**
 * Find the last safe point to split streaming markdown.
 * Returns `content.length` if no safe split exists.
 *
 * Safe = last `\n\n` that is NOT inside a fenced code block.
 */
/**
 * Scan for code fence and paragraph boundary positions in markdown text.
 * Returns the last `\n\n` position (after the break) that is NOT inside a fenced code block.
 * Returns 0 if no stable boundary exists.
 */
function scanBlockBoundary(content: string): number {
  let inCodeFence = false;
  let lastBoundary = 0;
  let i = 0;

  while (i < content.length) {
    // Check for code fence (``` or ~~~)
    if (
      (content[i] === "`" && content[i + 1] === "`" && content[i + 2] === "`") ||
      (content[i] === "~" && content[i + 1] === "~" && content[i + 2] === "~")
    ) {
      // Ensure it's at line start (i === 0 or preceded by \n)
      if (i === 0 || content[i - 1] === "\n") {
        inCodeFence = !inCodeFence;
      }
      // Skip past the fence markers
      const fenceChar = content[i];
      while (i < content.length && content[i] === fenceChar) i++;
      // Skip rest of line (language tag etc.)
      while (i < content.length && content[i] !== "\n") i++;
      continue;
    }

    // Check for paragraph break (double newline) outside code fences
    if (!inCodeFence && content[i] === "\n" && content[i + 1] === "\n") {
      // Position after the double newline is the split point
      lastBoundary = i + 2;
      i += 2;
      // Skip any additional blank lines
      while (i < content.length && content[i] === "\n") {
        lastBoundary = i + 1;
        i++;
      }
      continue;
    }

    i++;
  }

  return lastBoundary;
}

/**
 * Find the last safe point to split streaming markdown.
 * Returns `content.length` if no safe split exists.
 *
 * Safe = last `\n\n` that is NOT inside a fenced code block.
 */
export function findLastSafeSplitPoint(content: string): number {
  const boundary = scanBlockBoundary(content);
  return boundary > 0 ? boundary : content.length;
}

/**
 * Find the last position in text that is a stable block boundary
 * (double newline NOT inside a fenced code block).
 * Returns 0 if no stable boundary exists.
 *
 * Used by incremental markdown parsing to identify finalized blocks.
 */
export function findLastStableBlockBoundary(text: string): number {
  return scanBlockBoundary(text);
}
