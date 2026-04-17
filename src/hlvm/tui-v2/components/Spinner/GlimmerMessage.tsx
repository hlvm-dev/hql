import React from "react";
import Text from "../../ink/components/Text.tsx";
import { stringWidth } from "../../ink/stringWidth.ts";
import type { Color } from "../../ink/styles.ts";
import { getGraphemeSegmenter } from "../../stubs/intl.ts";
import type { SpinnerMode } from "./types.ts";
import { interpolateColor, parseRGB, toRGBColor } from "./utils.ts";

type Props = {
  message: string;
  mode: SpinnerMode;
  messageColor: Color;
  glimmerIndex: number;
  flashOpacity: number;
  shimmerColor: Color;
  stalledIntensity?: number;
};

const ERROR_RED = { r: 171, g: 43, b: 63 };

export function GlimmerMessage({
  message,
  mode,
  messageColor,
  glimmerIndex,
  flashOpacity,
  shimmerColor,
  stalledIntensity = 0,
}: Props): React.ReactNode {
  const { segments, messageWidth } = React.useMemo(() => {
    const segs: { segment: string; width: number }[] = [];
    for (const { segment } of getGraphemeSegmenter().segment(message)) {
      segs.push({ segment, width: stringWidth(segment) });
    }
    return { segments: segs, messageWidth: stringWidth(message) };
  }, [message]);

  if (!message) return null;

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
      const color = toRGBColor(interpolated);
      return (
        <>
          <Text color={color}>{message}</Text>
          <Text color={color}>{" "}</Text>
        </>
      );
    }

    const color: Color = stalledIntensity > 0.5 ? "ansi:red" : messageColor;
    return (
      <>
        <Text color={color}>{message}</Text>
        <Text color={color}>{" "}</Text>
      </>
    );
  }

  if (mode === "tool-use") {
    const baseRGB = typeof messageColor === "string"
      ? parseRGB(messageColor)
      : null;
    const shimmerRGB = typeof shimmerColor === "string"
      ? parseRGB(shimmerColor)
      : null;

    if (baseRGB && shimmerRGB) {
      const interpolated = interpolateColor(baseRGB, shimmerRGB, flashOpacity);
      return (
        <>
          <Text color={toRGBColor(interpolated)}>{message}</Text>
          <Text color={messageColor}>{" "}</Text>
        </>
      );
    }

    const color = flashOpacity > 0.5 ? shimmerColor : messageColor;
    return (
      <>
        <Text color={color}>{message}</Text>
        <Text color={messageColor}>{" "}</Text>
      </>
    );
  }

  const shimmerStart = glimmerIndex - 1;
  const shimmerEnd = glimmerIndex + 1;

  if (shimmerStart >= messageWidth || shimmerEnd < 0) {
    return (
      <>
        <Text color={messageColor}>{message}</Text>
        <Text color={messageColor}>{" "}</Text>
      </>
    );
  }

  const clampedStart = Math.max(0, shimmerStart);
  let colPos = 0;
  let before = "";
  let shim = "";
  let after = "";
  for (const { segment, width } of segments) {
    if (colPos + width <= clampedStart) {
      before += segment;
    } else if (colPos > shimmerEnd) {
      after += segment;
    } else {
      shim += segment;
    }
    colPos += width;
  }

  return (
    <>
      {before && <Text color={messageColor}>{before}</Text>}
      <Text color={shimmerColor}>{shim}</Text>
      {after && <Text color={messageColor}>{after}</Text>}
      <Text color={messageColor}>{" "}</Text>
    </>
  );
}
