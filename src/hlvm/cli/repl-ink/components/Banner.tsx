/**
 * HLVM Ink REPL - Premium Banner Component
 * SICP-inspired design with professional CLI aesthetics
 */

import React from "react";
import { Box, Text } from "ink";
import { version as VERSION } from "../../../../../mod.ts";
import { useTheme } from "../../theme/index.ts";

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
  errors: string[];
  modelName?: string;
}

export function Banner(
  { aiExports, errors, modelName }: BannerProps,
): React.ReactElement {
  const { color } = useTheme();
  const model = modelName?.trim() ?? "";

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
        <Text
          color={aiExports.length > 0 ? color("success") : undefined}
          dimColor={aiExports.length === 0}
        >
          AI {aiExports.length > 0 ? "available" : "unavailable"}
        </Text>
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
