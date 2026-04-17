import React from "react";
import Box from "../../ink/components/Box.tsx";
import Text from "../../ink/components/Text.tsx";
import type { Color } from "../../ink/styles.ts";
import {
  getDefaultCharacters,
  interpolateColor,
  parseRGB,
  toRGBColor,
} from "./utils.ts";

const DEFAULT_CHARACTERS = getDefaultCharacters();

const SPINNER_FRAMES = [
  ...DEFAULT_CHARACTERS,
  ...[...DEFAULT_CHARACTERS].reverse(),
];

const REDUCED_MOTION_DOT = "●";
const REDUCED_MOTION_CYCLE_MS = 2000;
const ERROR_RED = { r: 171, g: 43, b: 63 };

type Props = {
  frame: number;
  messageColor: Color;
  stalledIntensity?: number;
  reducedMotion?: boolean;
  time?: number;
};

export function SpinnerGlyph({
  frame,
  messageColor,
  stalledIntensity = 0,
  reducedMotion = false,
  time = 0,
}: Props): React.ReactNode {
  if (reducedMotion) {
    const isDim = Math.floor(time / (REDUCED_MOTION_CYCLE_MS / 2)) % 2 === 1;
    return (
      <Box flexWrap="wrap" height={1} width={2}>
        <Text color={messageColor} dimColor={isDim}>
          {REDUCED_MOTION_DOT}
        </Text>
      </Box>
    );
  }

  const spinnerChar = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];

  if (stalledIntensity > 0) {
    const baseRGB = typeof messageColor === "string"
      ? parseRGB(messageColor)
      : null;

    if (baseRGB) {
      const interpolated = interpolateColor(
        baseRGB,
        ERROR_RED,
        stalledIntensity,
      );
      return (
        <Box flexWrap="wrap" height={1} width={2}>
          <Text color={toRGBColor(interpolated)}>{spinnerChar}</Text>
        </Box>
      );
    }

    const color: Color = stalledIntensity > 0.5 ? "ansi:red" : messageColor;
    return (
      <Box flexWrap="wrap" height={1} width={2}>
        <Text color={color}>{spinnerChar}</Text>
      </Box>
    );
  }

  return (
    <Box flexWrap="wrap" height={1} width={2}>
      <Text color={messageColor}>{spinnerChar}</Text>
    </Box>
  );
}
