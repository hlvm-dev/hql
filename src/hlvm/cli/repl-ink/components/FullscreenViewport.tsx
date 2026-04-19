/**
 * FullscreenViewport — constrains the REPL to the terminal viewport while
 * delegating fullscreen ownership to the donor runtime.
 */

import React, { type PropsWithChildren } from "react";
import { Box } from "ink";
import { AlternateScreen } from "../../../tui-v2/ink/components/AlternateScreen.tsx";
import {
  isFullscreenEnvEnabled,
  isMouseTrackingEnabled,
} from "../../../tui-v2/utils/fullscreen.ts";

export function FullscreenViewport(
  { children }: PropsWithChildren,
): React.ReactElement {
  const shell = (
    <Box
      flexDirection="column"
      flexGrow={1}
      height="100%"
      width="100%"
      overflow="hidden"
    >
      {children}
    </Box>
  );

  if (!isFullscreenEnvEnabled()) {
    return shell;
  }

  return (
    <AlternateScreen mouseTracking={isMouseTrackingEnabled()}>
      {shell}
    </AlternateScreen>
  );
}
