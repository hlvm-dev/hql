import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import type { PromptInputMode } from "../types/textInputTypes.ts";
import { DONOR_BASH_BORDER, DONOR_INACTIVE } from "../theme/donorTheme.ts";

type Props = {
  mode: PromptInputMode;
  isLoading: boolean;
};

export function PromptInputModeIndicator(
  { mode, isLoading }: Props,
): React.ReactNode {
  // CC-parity: the prompt indicator is `❯ ` (glyph + one space) with no
  // extra marginRight. Previously `marginRight={1}` added a second space,
  // producing `❯  value` where CC renders `❯ value`.
  return (
    <Box
      alignItems="flex-start"
      alignSelf="flex-start"
      flexWrap="nowrap"
      justifyContent="flex-start"
    >
      {mode === "bash"
        ? <Text color={DONOR_BASH_BORDER} dim={isLoading}>!</Text>
        : (
          <Text
            bold
            color={isLoading ? DONOR_INACTIVE : undefined}
          >
            ❯
          </Text>
        )}
      <Text> </Text>
    </Box>
  );
}
