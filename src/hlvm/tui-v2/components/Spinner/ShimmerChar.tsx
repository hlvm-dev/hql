import React from "react";
import Text from "../../ink/components/Text.tsx";
import type { Color } from "../../ink/styles.ts";

type Props = {
  char: string;
  index: number;
  glimmerIndex: number;
  messageColor: Color;
  shimmerColor: Color;
};

export function ShimmerChar({
  char,
  index,
  glimmerIndex,
  messageColor,
  shimmerColor,
}: Props): React.ReactNode {
  const isHighlighted = index === glimmerIndex;
  const isNearHighlight = Math.abs(index - glimmerIndex) === 1;
  const color = isHighlighted || isNearHighlight ? shimmerColor : messageColor;

  return <Text color={color}>{char}</Text>;
}
