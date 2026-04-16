// @ts-nocheck
import React from "react";
import { Ansi } from "../ink/Ansi.tsx";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import { useAnimationFrame } from "../ink/hooks/use-animation-frame.ts";
import type { TextHighlight } from "../types/textInputTypes.ts";
import { segmentTextByHighlights } from "../utils/textHighlighting.ts";
import { ShimmerChar } from "../components/Spinner/ShimmerChar.tsx";

type Props = {
  text: string;
  highlights: TextHighlight[];
};

type LinePart = {
  text: string;
  highlight: TextHighlight | undefined;
  start: number;
};

export function HighlightedInput({ text, highlights }: Props): React.ReactNode {
  const { lines, hasShimmer, sweepStart, cycleLength } = React.useMemo(() => {
    const segments = segmentTextByHighlights(text, highlights);
    const lines: LinePart[][] = [[]];
    let pos = 0;

    for (const segment of segments) {
      const parts = segment.text.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
          lines.push([]);
          pos += 1;
        }

        const part = parts[i]!;
        if (part.length > 0) {
          lines[lines.length - 1]!.push({
            text: part,
            highlight: segment.highlight,
            start: pos,
          });
        }

        pos += part.length;
      }
    }

    const hasShimmer = highlights.some((highlight) => highlight.shimmerColor);
    let sweepStart = 0;
    let cycleLength = 1;

    if (hasShimmer) {
      const padding = 10;
      let lo = Infinity;
      let hi = -Infinity;

      for (const highlight of highlights) {
        if (highlight.shimmerColor) {
          lo = Math.min(lo, highlight.start);
          hi = Math.max(hi, highlight.end);
        }
      }

      sweepStart = lo - padding;
      cycleLength = hi - lo + padding * 2;
    }

    return { lines, hasShimmer, sweepStart, cycleLength };
  }, [text, highlights]);

  const [ref, time] = useAnimationFrame(hasShimmer ? 50 : null);
  const glimmerIndex = hasShimmer
    ? sweepStart + (Math.floor(time / 50) % cycleLength)
    : -100;

  return (
    <Box ref={ref} flexDirection="column">
      {lines.map((lineParts, lineIndex) => (
        <Box key={lineIndex}>
          {lineParts.length === 0
            ? <Text> </Text>
            : lineParts.map((part, partIndex) => {
              if (part.highlight?.shimmerColor && part.highlight.color) {
                return (
                  <Text key={partIndex}>
                    {part.text.split("").map((char, charIndex) => (
                      <ShimmerChar
                        key={charIndex}
                        char={char}
                        index={part.start + charIndex}
                        glimmerIndex={glimmerIndex}
                        messageColor={part.highlight!.color!}
                        shimmerColor={part.highlight!.shimmerColor!}
                      />
                    ))}
                  </Text>
                );
              }

              return (
                <Text
                  key={partIndex}
                  color={part.highlight?.color}
                  dim={part.highlight?.dimColor}
                  inverse={part.highlight?.inverse}
                >
                  <Ansi>{part.text}</Ansi>
                </Text>
              );
            })}
        </Box>
      ))}
    </Box>
  );
}
