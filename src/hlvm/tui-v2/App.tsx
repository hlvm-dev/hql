import React from "react";
import { AlternateScreen } from "./ink/components/AlternateScreen.tsx";
import Box from "./ink/components/Box.tsx";
import { HLVMBanner } from "./header/HLVMBanner.tsx";
import { TranscriptWorkbench } from "./transcript/TranscriptWorkbench.tsx";
import {
  isFullscreenEnvEnabled,
  isMouseTrackingEnabled,
} from "./utils/fullscreen.ts";

export interface AppProps {
  showBanner: boolean;
}

export default function App({ showBanner }: AppProps) {
  const shell = (
    <Box
      flexDirection="column"
      height="100%"
      width="100%"
      paddingX={1}
      paddingY={1}
    >
      {showBanner && <HLVMBanner />}
      <TranscriptWorkbench />
    </Box>
  );

  if (!isFullscreenEnvEnabled()) {
    return shell;
  }

  return <AlternateScreen mouseTracking={isMouseTrackingEnabled()}>{shell}</AlternateScreen>;
}
