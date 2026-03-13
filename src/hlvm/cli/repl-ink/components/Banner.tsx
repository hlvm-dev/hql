/**
 * HLVM Ink REPL - Premium Banner Component
 * SICP-inspired design with professional CLI aesthetics
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { version as VERSION } from "../../../../../mod.ts";
import { useTheme } from "../../theme/index.ts";
import type { ConfiguredModelReadinessState } from "../../../runtime/configured-model-readiness.ts";
import { truncate } from "../../../../common/utils.ts";
import {
  DEFAULT_TERMINAL_HEIGHT,
  DEFAULT_TERMINAL_WIDTH,
} from "../ui-constants.ts";

const LOGO_LINES = [
  "██╗  ██╗ ██╗      ██╗   ██╗ ███╗   ███╗",
  "██║  ██║ ██║      ██║   ██║ ████╗ ████║",
  "███████║ ██║      ██║   ██║ ██╔████╔██║",
  "██╔══██║ ██║      ╚██╗ ██╔╝ ██║╚██╔╝██║",
  "██║  ██║ ███████╗  ╚████╔╝  ██║ ╚═╝ ██║",
  "╚═╝  ╚═╝ ╚══════╝   ╚═══╝   ╚═╝     ╚═╝",
] as const;

const SYMBOLS = {
  bullet: "◆",
} as const;

const FULL_LOGO_WIDTH = Math.max(...LOGO_LINES.map((line) => line.length));

interface BannerProps {
  aiExports: string[];
  aiReadiness: ConfiguredModelReadinessState;
  errors: string[];
  modelName?: string;
}

interface BannerAiIndicator {
  label: string;
  tone: "success" | "warning" | "error";
}

export function getBannerRowCount(
  errorCount: number,
  width = DEFAULT_TERMINAL_WIDTH,
  height = DEFAULT_TERMINAL_HEIGHT,
): number {
  const compact = shouldUseCompactBanner(width, height);
  const logoRows = compact ? 1 : LOGO_LINES.length;
  const spacerRows = !compact && height >= 18 ? 1 : 0;
  const warningRows = errorCount > 0 ? 1 : 0;
  const marginBottomRows = 1;
  return logoRows + 1 + spacerRows + 1 + warningRows + marginBottomRows;
}

export function shouldUseCompactBanner(
  width: number,
  height = DEFAULT_TERMINAL_HEIGHT,
): boolean {
  return width < FULL_LOGO_WIDTH + 4 || height < 22;
}

export function resolveBannerAiIndicator(
  aiHelpersLoaded: boolean,
  aiReadiness: ConfiguredModelReadinessState,
): BannerAiIndicator {
  if (!aiHelpersLoaded) {
    return { label: "AI unavailable", tone: "error" };
  }

  switch (aiReadiness) {
    case "available":
      return { label: "AI available", tone: "success" };
    case "setup_required":
      return { label: "AI setup required", tone: "warning" };
    default:
      return { label: "AI unavailable", tone: "error" };
  }
}

export function Banner(
  { aiExports, aiReadiness, errors, modelName }: BannerProps,
): React.ReactElement {
  const { stdout } = useStdout();
  const { color } = useTheme();
  const model = modelName?.trim() ?? "";
  const indicator = resolveBannerAiIndicator(aiExports.length > 0, aiReadiness);
  const terminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  const terminalHeight = stdout?.rows ?? DEFAULT_TERMINAL_HEIGHT;
  const compact = shouldUseCompactBanner(terminalWidth, terminalHeight);
  const showSpacer = !compact && terminalHeight >= 18;
  const contentWidth = Math.max(20, terminalWidth - 2);
  const statusLabel = model ? `${indicator.label} · ${model}` : indicator.label;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column">
        {(compact ? ["HLVM"] : LOGO_LINES).map((line, index) => (
          <React.Fragment key={index}>
            <Text color={color("primary")} bold>
              {line}
            </Text>
          </React.Fragment>
        ))}
      </Box>

      <Text color={color("secondary")} bold>
        {truncate(
          `HLVM ${VERSION} • AI-native runtime infrastructure`,
          contentWidth,
          "…",
        )}
      </Text>
      {showSpacer && <Text />}

      <Box>
        <Text color={color("secondary")}>{SYMBOLS.bullet}</Text>
        <Text color={color(indicator.tone)}>
          {truncate(statusLabel, Math.max(8, contentWidth - 2), "…")}
        </Text>
      </Box>

      {errors.length > 0 && (
        <Text color={color("warning")}>
          {truncate(
            `⚠ ${errors.length} warning${
              errors.length > 1 ? "s" : ""
            } (run /warnings for details)`,
            contentWidth,
            "…",
          )}
        </Text>
      )}
    </Box>
  );
}
