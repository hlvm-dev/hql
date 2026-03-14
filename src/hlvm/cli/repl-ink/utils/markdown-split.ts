/**
 * Markdown-aware text splitting for progressive streaming.
 *
 * Finds safe paragraph boundaries to split growing streaming text
 * so that completed blocks can move to <Static> (rendered once).
 */

/** State for incremental block boundary scanning across streaming renders. */
export interface BlockBoundaryScanState {
  lastBoundary: number;
  inCodeFence: boolean;
  scannedTo: number;
}

/**
 * Incremental version of scanBlockBoundary — resumes from previous state.
 * During streaming (append-only text), scans only the new suffix: O(delta) per flush.
 * Falls back to full scan when text doesn't extend the previous scan.
 */
export function scanBlockBoundaryIncremental(
  content: string,
  prev?: BlockBoundaryScanState,
): { boundary: number; state: BlockBoundaryScanState } {
  const canResume = prev && content.length >= prev.scannedTo;
  let inCodeFence = canResume ? prev.inCodeFence : false;
  let lastBoundary = canResume ? prev.lastBoundary : 0;
  let i = canResume ? prev.scannedTo : 0;

  while (i < content.length) {
    if (
      (content[i] === "`" && content[i + 1] === "`" && content[i + 2] === "`") ||
      (content[i] === "~" && content[i + 1] === "~" && content[i + 2] === "~")
    ) {
      if (i === 0 || content[i - 1] === "\n") {
        inCodeFence = !inCodeFence;
      }
      const fenceChar = content[i];
      while (i < content.length && content[i] === fenceChar) i++;
      while (i < content.length && content[i] !== "\n") i++;
      continue;
    }

    if (!inCodeFence && content[i] === "\n" && content[i + 1] === "\n") {
      lastBoundary = i + 2;
      i += 2;
      while (i < content.length && content[i] === "\n") {
        lastBoundary = i + 1;
        i++;
      }
      continue;
    }

    i++;
  }

  return {
    boundary: lastBoundary,
    state: { lastBoundary, inCodeFence, scannedTo: content.length },
  };
}
