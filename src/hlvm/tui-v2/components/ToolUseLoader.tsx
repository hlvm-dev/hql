import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import { BLACK_CIRCLE } from "../constants/figures.ts";
import { useBlink } from "../hooks/useBlink.ts";

type Props = {
  isError: boolean;
  isUnresolved: boolean;
  shouldAnimate: boolean;
};

export function ToolUseLoader(
  { isError, isUnresolved, shouldAnimate }: Props,
): React.ReactNode {
  const [ref, isBlinking] = useBlink(shouldAnimate);

  const color = isUnresolved
    ? undefined
    : isError
    ? "red"
    : "green";

  return (
    <Box ref={ref} minWidth={2}>
      <Text color={color} dimColor={isUnresolved}>
        {!shouldAnimate || isBlinking || isError || !isUnresolved
          ? BLACK_CIRCLE
          : " "}
      </Text>
    </Box>
  );
}
