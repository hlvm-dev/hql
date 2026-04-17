import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";

// CC parity port of ~/dev/ClaudeCode-main/components/PromptInput/
// PromptInputHelpMenu.tsx — three-column dim-text layout, rendered in the
// footer area when the user presses `?` on an empty prompt. Content is
// HLVM-flavored (only shortcuts HLVM actually has); structure matches CC.
//
// Column 1: composer triggers (HLVM-applicable subset of CC's column 1)
// Column 2: editing affordances
// Column 3: modifier shortcuts
//
// Shortcuts omitted from CC because HLVM does not have them yet:
//   - `& for background` (no background agents)
//   - `/btw for side question` (no side-channel threads)
//   - `ctrl + o for verbose output` (no verbose-toggle)
//   - `alt + p to switch model` (no in-shell model picker yet)
//   - `alt + o to toggle fast mode` (no fast-mode toggle)
//   - `/keybindings to customize` (keybindings not user-customisable yet)

type Props = {
  dimColor?: boolean;
  gap?: number;
  paddingX?: number;
};

export function ShortcutsHelpMenu({
  dimColor = true,
  gap = 2,
  paddingX = 2,
}: Props): React.ReactElement {
  return (
    <Box paddingX={paddingX} flexDirection="row" gap={gap}>
      <Box flexDirection="column">
        <Text dimColor={dimColor}>! for bash mode</Text>
        <Text dimColor={dimColor}>/ for commands</Text>
        <Text dimColor={dimColor}>@ for file paths</Text>
      </Box>
      <Box flexDirection="column">
        <Text dimColor={dimColor}>shift + tab to cycle permission mode</Text>
        <Text dimColor={dimColor}>ctrl + f to search transcript</Text>
        <Text dimColor={dimColor}>ctrl + r to search history</Text>
        <Text dimColor={dimColor}>\⏎ for newline</Text>
      </Box>
      <Box flexDirection="column">
        <Text dimColor={dimColor}>ctrl + d to toggle docs</Text>
        <Text dimColor={dimColor}>pgup / pgdn to scroll transcript</Text>
        <Text dimColor={dimColor}>tab to autocomplete</Text>
        <Text dimColor={dimColor}>ctrl + c to exit</Text>
      </Box>
    </Box>
  );
}
