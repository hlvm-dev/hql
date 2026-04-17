import React from "react";
import Text from "../ink/components/Text.tsx";

interface TextSegment {
  readonly text: string;
  readonly highlighted: boolean;
}

type Props = {
  readonly text: string;
  readonly matchIndices?: readonly number[];
  readonly highlightColor?: string;
  readonly baseColor?: string;
  readonly backgroundColor?: string;
  readonly bold?: boolean;
  readonly underline?: boolean;
  readonly inverse?: boolean;
};

function splitByIndices(
  text: string,
  indices: readonly number[],
): TextSegment[] {
  if (!indices.length) {
    return [{ text, highlighted: false }];
  }

  const segments: TextSegment[] = [];
  const indexSet = new Set(indices);
  let segStart = 0;
  let currentHighlighted = indexSet.has(0);

  for (let i = 1; i <= text.length; i++) {
    const isHighlighted = i < text.length && indexSet.has(i);
    if (i === text.length || isHighlighted !== currentHighlighted) {
      segments.push({
        text: text.slice(segStart, i),
        highlighted: currentHighlighted,
      });
      segStart = i;
      currentHighlighted = isHighlighted;
    }
  }

  return segments;
}

export function HighlightedText({
  text,
  matchIndices,
  highlightColor = "yellow",
  baseColor,
  backgroundColor,
  bold = true,
  underline = false,
  inverse = false,
}: Props): React.ReactElement {
  if (!matchIndices || matchIndices.length === 0) {
    return (
      <Text
        color={baseColor}
        backgroundColor={backgroundColor}
        inverse={inverse}
      >
        {text}
      </Text>
    );
  }

  const segments = splitByIndices(text, matchIndices);

  return (
    <Text backgroundColor={backgroundColor} inverse={inverse}>
      {segments.map((segment, index) =>
        segment.highlighted
          ? (
            <React.Fragment key={index}>
              <Text
                color={highlightColor}
                backgroundColor={backgroundColor}
                bold={bold}
                underline={underline}
              >
                {segment.text}
              </Text>
            </React.Fragment>
          )
          : (
            <React.Fragment key={index}>
              <Text color={baseColor} backgroundColor={backgroundColor}>
                {segment.text}
              </Text>
            </React.Fragment>
          )
      )}
    </Text>
  );
}
