import React from "react";
import { Box, Text, useStdout } from "ink";
import { version as VERSION } from "../../../../../mod.ts";
import type { ConfiguredModelReadinessState } from "../../../runtime/configured-model-readiness.ts";
import { truncate } from "../../../../common/utils.ts";
import { useSemanticColors } from "../../theme/index.ts";
import {
  DEFAULT_TERMINAL_HEIGHT,
  DEFAULT_TERMINAL_WIDTH,
} from "../ui-constants.ts";

const EXTENDED_BANNER_MIN_WIDTH = 96;
const EXTENDED_BANNER_MIN_HEIGHT = 28;
const SECTION_SEPARATOR = " · ";

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
  const statusRows = compact ? 1 : 2;
  const warningRows = errorCount > 0 ? 1 : 0;
  const marginBottomRows = 1;
  return statusRows + warningRows + marginBottomRows;
}

export function shouldUseCompactBanner(
  width: number,
  height = DEFAULT_TERMINAL_HEIGHT,
): boolean {
  return width < EXTENDED_BANNER_MIN_WIDTH ||
    height < EXTENDED_BANNER_MIN_HEIGHT;
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

function buildStatusLine(
  indicator: BannerAiIndicator,
  modelName: string,
  width: number,
): { modelText: string; baseText: string } {
  const brandText = `HLVM ${VERSION}`;
  const baseText = `${brandText}${SECTION_SEPARATOR}${indicator.label}`;
  if (!modelName) {
    return { modelText: "", baseText };
  }
  const availableModelWidth = Math.max(
    8,
    width - baseText.length - SECTION_SEPARATOR.length,
  );
  return {
    modelText: truncate(modelName, availableModelWidth, "…"),
    baseText,
  };
}

export function Banner(
  { aiExports, aiReadiness, errors, modelName }: BannerProps,
): React.ReactElement {
  const { stdout } = useStdout();
  const sc = useSemanticColors();
  const model = modelName?.trim() ?? "";
  const indicator = resolveBannerAiIndicator(aiExports.length > 0, aiReadiness);
  const terminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  const terminalHeight = stdout?.rows ?? DEFAULT_TERMINAL_HEIGHT;
  const compact = shouldUseCompactBanner(terminalWidth, terminalHeight);
  const contentWidth = Math.max(20, terminalWidth - 2);
  const statusLine = buildStatusLine(indicator, model, contentWidth);
  const helperLine = truncate(
    compact
      ? "Focused terminal chat for code, tools, and sessions"
      : "Focused terminal chat for code, tools, sessions, and local models",
    contentWidth,
    "…",
  );

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={sc.border.active} bold>
          HLVM
        </Text>
        <Text color={sc.text.muted}>{` ${VERSION}`}</Text>
        <Text color={sc.text.muted}>{SECTION_SEPARATOR}</Text>
        <Text color={sc.status[indicator.tone]}>{indicator.label}</Text>
        {statusLine.modelText && (
          <>
            <Text color={sc.text.muted}>{SECTION_SEPARATOR}</Text>
            <Text color={sc.text.secondary}>{statusLine.modelText}</Text>
          </>
        )}
      </Box>

      {!compact && (
        <Text color={sc.text.muted}>{helperLine}</Text>
      )}

      {errors.length > 0 && (
        <Text color={sc.status.warning}>
          {truncate(
            `${errors.length} warning${errors.length === 1 ? "" : "s"} · /warnings for details`,
            contentWidth,
            "…",
          )}
        </Text>
      )}
    </Box>
  );
}
