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
  return (
    <Box
      alignItems="flex-start"
      alignSelf="flex-start"
      flexWrap="nowrap"
      justifyContent="flex-start"
      marginRight={1}
    >
      {mode === "bash"
        ? <Text color={DONOR_BASH_BORDER} dim={isLoading}>! </Text>
        : (
          <Text
            bold
            color={isLoading ? DONOR_INACTIVE : undefined}
          >
            ❯{" "}
          </Text>
        )}
    </Box>
  );
}
