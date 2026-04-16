import React from "react";
import { VERSION } from "../../../common/version.ts";
import { useTerminalSize } from "../hooks/useTerminalSize.ts";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import { stringWidth } from "../ink/stringWidth.ts";

const LOGO_LINES = [
  "██  ██ ██      ██    ██ ██    ██",
  "██  ██ ██      ██    ██ ███  ███",
  "██████ ██      ██    ██ ██ ██ ██",
  "██  ██ ██       ██  ██  ██    ██",
  "██  ██ ███████   ████   ██    ██",
] as const;

const FULL_LOGO_WIDTH = Math.max(...LOGO_LINES.map((line) => line.length));
const SICP_LOGO_START = "rgb(90,58,151)";
const SICP_LOGO_MIDDLE = "rgb(216,90,67)";
const SICP_LOGO_END = "rgb(239,227,194)";
const SICP_META = "rgb(246,238,220)";

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function interpolateColor(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  ratio: number,
): string {
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const [fr, fg, fb] = from;
  const [tr, tg, tb] = to;
  return `rgb(${
    clampChannel(fr + (tr - fr) * clampedRatio)
  },${
    clampChannel(fg + (tg - fg) * clampedRatio)
  },${
    clampChannel(fb + (tb - fb) * clampedRatio)
  })`;
}

function truncateEnd(value: string, width: number): string {
  if (width <= 0) return "";
  if (stringWidth(value) <= width) return value;
  if (width <= 1) return "…";
  return `${value.slice(0, Math.max(0, width - 1))}…`;
}

function shouldUseCompactBanner(width: number, height: number): boolean {
  return width < FULL_LOGO_WIDTH + 4 || height < 22;
}

function buildLogoColors(compact: boolean): readonly string[] {
  if (compact) {
    return [SICP_LOGO_START];
  }

  const from: readonly [number, number, number] = [90, 58, 151];
  const mid: readonly [number, number, number] = [216, 90, 67];
  const to: readonly [number, number, number] = [239, 227, 194];

  return LOGO_LINES.map((_, index) => {
    const position = LOGO_LINES.length <= 1 ? 0 : index / (LOGO_LINES.length - 1);
    return position <= 0.5
      ? interpolateColor(from, mid, position * 2)
      : interpolateColor(mid, to, (position - 0.5) * 2);
  });
}

export function HLVMBanner(): React.ReactNode {
  const { columns, rows } = useTerminalSize();
  const compact = shouldUseCompactBanner(columns, rows);
  const contentWidth = Math.max(20, columns - 2);
  const titleLine = truncateEnd(
    `HLVM ${VERSION} — High Level Virtual Machine`,
    contentWidth,
  );
  const logoColors = buildLogoColors(compact);
  const lines = compact ? ["HLVM"] : LOGO_LINES;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column">
        {lines.map((line, index) => (
          <Text key={index} color={logoColors[index] ?? SICP_LOGO_START} bold>
            {line}
          </Text>
        ))}
      </Box>
      {!compact && <Text />}
      <Text color={SICP_META} bold={!compact}>
        {titleLine}
      </Text>
    </Box>
  );
}
