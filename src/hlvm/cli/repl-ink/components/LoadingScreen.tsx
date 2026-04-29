/**
 * HLVM Ink REPL - Loading Screen with Detailed Progress
 */

import React from "react";
import { Box, Text } from "ink";
import { useConversationSpinnerFrame } from "../hooks/useConversationMotion.ts";
import type { InitProgressEvent } from "../../../../common/runtime-progress.ts";

interface LoadingScreenProps {
  progress?: InitProgressEvent;
}

export function LoadingScreen({ progress }: LoadingScreenProps): React.ReactElement {
  const spinner = useConversationSpinnerFrame(true);
  const status = progress
    ? `[${progress.step}/${progress.total}] ${progress.label}`
    : "Initializing runtime components";

  return (
    <Box paddingY={1}>
      <Text dimColor>
        {spinner} Loading HLVM
        {" · "}
        {status}
      </Text>
    </Box>
  );
}
