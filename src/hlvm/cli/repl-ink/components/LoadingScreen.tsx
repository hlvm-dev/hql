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

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text dimColor>
        {spinner} Loading HLVM...
      </Text>
      {progress && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            {`  [${progress.step}/${progress.total}] ${progress.label}`}
          </Text>
        </Box>
      )}
      {!progress && (
        <Text dimColor>  Initializing runtime components</Text>
      )}
    </Box>
  );
}
