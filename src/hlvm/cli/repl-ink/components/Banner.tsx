/**
 * HLVM Ink REPL - Premium Banner Component
 * SICP-inspired design with professional CLI aesthetics
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { version as VERSION } from "../../../../../mod.ts";
import { useSemanticColors, useTheme } from "../../theme/index.ts";
import type { SemanticColors } from "../../theme/index.ts";
import type { ConfiguredModelReadinessState } from "../../../runtime/configured-model-readiness.ts";
import { truncate } from "../../../../common/utils.ts";
import {
  DEFAULT_TERMINAL_HEIGHT,
  DEFAULT_TERMINAL_WIDTH,
} from "../ui-constants.ts";

const LOGO_LINES = [
  "██  ██ ██      ██    ██ ██    ██",
  "██  ██ ██      ██    ██ ███  ███",
  "██████ ██      ██    ██ ██ ██ ██",
  "██  ██ ██       ██  ██  ██    ██",
  "██  ██ ███████   ████   ██    ██",
] as const;

const SYMBOLS = {
  bullet: "◆",
} as const;

const FULL_LOGO_WIDTH = Math.max(...LOGO_LINES.map((line) => line.length));
const bannerRampCache = new Map<string, readonly string[]>();

interface BannerProps {
  aiReadiness: ConfiguredModelReadinessState;
  errors: string[];
  modelName?: string;
}

interface BannerAiIndicator {
  label: string;
  tone: keyof SemanticColors["banner"]["status"];
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, "");
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${
    [r, g, b].map((channel) =>
      clampChannel(channel).toString(16).padStart(2, "0")
    ).join("")
  }`;
}

export function interpolateHexColor(
  fromHex: string,
  toHex: string,
  ratio: number,
): string {
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const from = hexToRgb(fromHex);
  const to = hexToRgb(toHex);

  return rgbToHex([
    from[0] + (to[0] - from[0]) * clampedRatio,
    from[1] + (to[1] - from[1]) * clampedRatio,
    from[2] + (to[2] - from[2]) * clampedRatio,
  ]);
}

export function getBannerLogoColors(
  themeName: string,
  banner: Pick<
    SemanticColors["banner"],
    "logoStart" | "logoMiddle" | "logoEnd"
  >,
  compact: boolean,
): readonly string[] {
  const cacheKey =
    `${themeName}:${compact}:${banner.logoStart}:${banner.logoMiddle}:${banner.logoEnd}`;
  const cached = bannerRampCache.get(cacheKey);
  if (cached) return cached;

  const colors = compact ? [banner.logoStart] : LOGO_LINES.map((_, index) => {
    const position = LOGO_LINES.length <= 1
      ? 0
      : index / (LOGO_LINES.length - 1);
    return position <= 0.5
      ? interpolateHexColor(
        banner.logoStart,
        banner.logoMiddle,
        position * 2,
      )
      : interpolateHexColor(
        banner.logoMiddle,
        banner.logoEnd,
        (position - 0.5) * 2,
      );
  });

  bannerRampCache.set(cacheKey, colors);
  return colors;
}

export function getBannerRowCount(
  errorCount: number,
  width = DEFAULT_TERMINAL_WIDTH,
  height = DEFAULT_TERMINAL_HEIGHT,
): number {
  const compact = shouldUseCompactBanner(width, height);
  const logoRows = compact ? 1 : LOGO_LINES.length;
  const spacerRows = compact ? 0 : 1; // blank line between logo and tagline
  const warningRows = errorCount > 0 ? 1 : 0;
  const marginBottomRows = 1;
  return logoRows + spacerRows + 1 + 1 + warningRows + marginBottomRows;
}

export function shouldUseCompactBanner(
  width: number,
  height = DEFAULT_TERMINAL_HEIGHT,
): boolean {
  return width < FULL_LOGO_WIDTH + 4 || height < 22;
}

export function resolveBannerAiIndicator(
  aiReadiness: ConfiguredModelReadinessState,
): BannerAiIndicator {
  switch (aiReadiness) {
    case "available":
      return { label: "AI available", tone: "ready" };
    case "setup_required":
      return { label: "AI setup required", tone: "attention" };
    default:
      return { label: "AI unavailable", tone: "error" };
  }
}

export function Banner(
  { aiReadiness, errors, modelName }: BannerProps,
): React.ReactElement {
  const { stdout } = useStdout();
  const { color, themeName } = useTheme();
  const sc = useSemanticColors();
  const model = modelName?.trim() ?? "";
  const indicator = resolveBannerAiIndicator(aiReadiness);
  const terminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  const terminalHeight = stdout?.rows ?? DEFAULT_TERMINAL_HEIGHT;
  const compact = shouldUseCompactBanner(terminalWidth, terminalHeight);
  const contentWidth = Math.max(20, terminalWidth - 2);
  const statusLabel = model ? `${indicator.label} · ${model}` : indicator.label;
  const logoColors = getBannerLogoColors(themeName, sc.banner, compact);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column">
        {(compact ? ["HLVM"] : LOGO_LINES).map((line, index) => (
          <React.Fragment key={index}>
            <Text color={logoColors[index] ?? color("primary")} bold>
              {line}
            </Text>
          </React.Fragment>
        ))}
      </Box>

      {!compact && <Text />}
      <Text color={sc.banner.meta} bold>
        {truncate(
          `HLVM ${VERSION} — High Level Virtual Machine`,
          contentWidth,
          "…",
        )}
      </Text>

      <Box>
        <Text color={sc.banner.bullet}>{SYMBOLS.bullet}</Text>
        <Text color={sc.banner.status[indicator.tone]}>
          {truncate(statusLabel, Math.max(8, contentWidth - 2), "…")}
        </Text>
      </Box>

      {errors.length > 0 && (
        <Text color={sc.banner.status.attention}>
          {truncate(
            `⚠ ${errors.length} warning${errors.length > 1 ? "s" : ""}`,
            contentWidth,
            "…",
          )}
        </Text>
      )}
    </Box>
  );
}
