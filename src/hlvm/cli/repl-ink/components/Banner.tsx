/**
 * HLVM Ink REPL - Premium Banner Component
 * SICP-inspired design with professional CLI aesthetics
 */

import React from "react";
import { Box, Text } from "ink";
import { version as VERSION } from "../../../../../mod.ts";
import { useTheme } from "../../theme/index.ts";
import type { ConfiguredModelReadinessState } from "../../../runtime/configured-model-readiness.ts";

// =============================================================================
// HLVM Premium Logo - Block-art design
// Colors: Logo = primary (SICP purple), Tagline = secondary (SICP red)
// =============================================================================

const LOGO_LINES = [
  "██╗  ██╗ ██╗      ██╗   ██╗ ███╗   ███╗",
  "██║  ██║ ██║      ██║   ██║ ████╗ ████║",
  "███████║ ██║      ██║   ██║ ██╔████╔██║",
  "██╔══██║ ██║      ╚██╗ ██╔╝ ██║╚██╔╝██║",
  "██║  ██║ ███████╗  ╚████╔╝  ██║ ╚═╝ ██║",
  "╚═╝  ╚═╝ ╚══════╝   ╚═══╝   ╚═╝     ╚═╝",
];

// Unicode symbols for professional look
const SYMBOLS = {
  bullet: "◆", // Diamond bullet for status items
} as const;

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
  const { color } = useTheme();
  const model = modelName?.trim() ?? "";
  const indicator = resolveBannerAiIndicator(aiExports.length > 0, aiReadiness);

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Logo */}
      <Box flexDirection="column">
        {LOGO_LINES.map((line, index) => (
          <React.Fragment key={index}>
            <Text color={color("primary")} bold>{line}</Text>
          </React.Fragment>
        ))}
      </Box>

      {/* Tagline */}
      <Text color={color("secondary")} bold>
        HLVM {VERSION} • AI-native runtime infrastructure
      </Text>
      <Text></Text>

      {/* Compact status line */}
      <Box>
        <Text color={color("secondary")}>{SYMBOLS.bullet}</Text>
        <Text color={color(indicator.tone)}>{indicator.label}</Text>
        {model && <Text dimColor>· {model}</Text>}
      </Box>

      {/* Compact warnings */}
      {errors.length > 0 && (
        <Text color={color("warning")}>
          ⚠ {errors.length} warning{errors.length > 1 ? "s" : ""}{" "}
          (run /warnings for details)
        </Text>
      )}
    </Box>
  );
}
