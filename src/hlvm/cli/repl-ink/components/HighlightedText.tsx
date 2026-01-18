/**
 * Shared Highlighted Text Component
 *
 * Renders text with fuzzy match indices highlighted.
 * Used by Dropdown (completion) and HistorySearchPrompt (Ctrl+R search).
 */

import React from "npm:react@18";
import { Text } from "npm:ink@5";

// ============================================================
// Types
// ============================================================

interface TextSegment {
  readonly text: string;
  readonly highlighted: boolean;
}

export interface HighlightedTextProps {
  /** The text to display */
  readonly text: string;
  /** Indices of characters to highlight (from fuzzy match) */
  readonly matchIndices?: readonly number[];
  /** Highlight color (default: "yellow") */
  readonly highlightColor?: string;
  /** Base text color (default: undefined = terminal default) */
  readonly baseColor?: string;
  /** Whether to bold highlighted text (default: true) */
  readonly bold?: boolean;
  /** Whether to underline highlighted text (default: false) */
  readonly underline?: boolean;
  /** Whether to render with inverse colors (for selection) */
  readonly inverse?: boolean;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Split text into segments based on match indices.
 * Returns alternating normal/highlighted segments for rendering.
 */
function splitByIndices(text: string, indices: readonly number[]): TextSegment[] {
  if (!indices.length) {
    return [{ text, highlighted: false }];
  }

  const segments: TextSegment[] = [];
  const indexSet = new Set(indices);
  let current = "";
  let currentHighlighted = indexSet.has(0);

  for (let i = 0; i < text.length; i++) {
    const isHighlighted = indexSet.has(i);
    if (isHighlighted !== currentHighlighted) {
      if (current) {
        segments.push({ text: current, highlighted: currentHighlighted });
      }
      current = text[i];
      currentHighlighted = isHighlighted;
    } else {
      current += text[i];
    }
  }

  if (current) {
    segments.push({ text: current, highlighted: currentHighlighted });
  }

  return segments;
}

// ============================================================
// Component
// ============================================================

/**
 * Render text with fuzzy match highlighting.
 * Highlighted characters are shown in bold yellow by default.
 *
 * @example
 * // Basic usage
 * <HighlightedText text="hello" matchIndices={[0, 2, 4]} />
 *
 * // With custom styling (history search style)
 * <HighlightedText text="(+ 1 2)" matchIndices={[1]} bold underline />
 *
 * // With inverse for selection (dropdown style)
 * <HighlightedText text="map" matchIndices={[0, 1]} inverse baseColor="cyan" />
 */
export function HighlightedText({
  text,
  matchIndices,
  highlightColor = "yellow",
  baseColor,
  bold = true,
  underline = false,
  inverse = false,
}: HighlightedTextProps): React.ReactElement {
  // If no highlights needed, render simple text
  if (!matchIndices || !matchIndices.length) {
    return (
      <Text color={baseColor} inverse={inverse}>
        {text}
      </Text>
    );
  }

  // Split into segments and render with highlights
  const segments = splitByIndices(text, matchIndices);

  return (
    <Text inverse={inverse}>
      {segments.map((seg, i) =>
        seg.highlighted ? (
          <React.Fragment key={i}>
            <Text color={highlightColor} bold={bold} underline={underline}>
              {seg.text}
            </Text>
          </React.Fragment>
        ) : (
          <React.Fragment key={i}>
            <Text color={baseColor}>
              {seg.text}
            </Text>
          </React.Fragment>
        )
      )}
    </Text>
  );
}
