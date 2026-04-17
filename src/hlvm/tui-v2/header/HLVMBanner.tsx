import React from "react";
import { VERSION } from "../../../common/version.ts";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";

// CC-parity banner layout (with HLVM branding per §3.2 of
// docs/vision/repl-v2-tui.md — the startup banner may use HLVM's branded
// startup banner instead of the donor Claude banner, but size/shape should
// match CC's compact 3-line glyph + right-side info-panel structure).
//
// Donor reference: ~/dev/ClaudeCode-main/components/PromptInput/PromptInput.tsx
// and its banner rendering — the full CC shell paints:
//
//              Claude Code v2.1.112
//    ▐▛███▜▌   Opus 4.7 (1M context) · Claude Max
//   ▝▜█████▛▘  ~/dev/hql
//     ▘▘ ▝▝    Welcome to Opus 4.7 xhigh! · /effort to tune speed vs. intelligence
//
// We mirror that 4-line shape: row 1 floats the product title above the
// glyph-right column, rows 2-4 pair the glyph with runtime / cwd / welcome.
// The glyph here is HLVM-themed (a small chip icon), not the CC Clawd glyph.

const GLYPH_LINES = [
  " ▗▄▖ ",
  "▐█▌ ▌",
  " ▝▀▘ ",
] as const;

const GLYPH_WIDTH = Math.max(...GLYPH_LINES.map((l) => l.length));
const GLYPH_COLOR = "rgb(215,119,87)"; // matches donor dark-theme clawd_body

export function HLVMBanner(): React.ReactNode {
  const cwd = getCwdLabel();
  const modelLine = "Local runtime · HLVM-managed";
  const welcomeLine = "Welcome · /effort to tune speed vs. intelligence";

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Row 1: product title floats above the glyph-right column */}
      <Box>
        <Box width={GLYPH_WIDTH + 2} />
        <Text bold>HLVM v{VERSION}</Text>
      </Box>
      {/* Rows 2-4: glyph on the left, runtime/cwd/welcome on the right */}
      {GLYPH_LINES.map((line, index) => (
        <Box key={index}>
          <Box width={GLYPH_WIDTH + 2}>
            <Text color={GLYPH_COLOR} bold>{line}</Text>
          </Box>
          <Text>
            {index === 0
              ? modelLine
              : index === 1
              ? cwd
              : welcomeLine}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function getCwdLabel(): string {
  try {
    const cwd = Deno.cwd();
    const home = Deno.env.get("HOME");
    if (home && cwd.startsWith(home)) {
      return "~" + cwd.slice(home.length);
    }
    return cwd;
  } catch {
    return "";
  }
}
