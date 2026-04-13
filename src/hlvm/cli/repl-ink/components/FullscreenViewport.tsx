/**
 * FullscreenViewport — constrains the entire TUI to terminal height.
 *
 * Wraps children in a fixed-height, overflow-hidden Box so that Ink's
 * flexbox layout has a ceiling.  Without this, flexGrow on any child
 * would cause unbounded expansion and Ink would lay out (and render)
 * every row of every mounted item.
 *
 * Alternate-screen enter/exit is handled at the entry-point level
 * (index.tsx), not here, to keep React lifecycle out of terminal mode
 * switching.
 */

import React, { type PropsWithChildren } from "react";
import { Box, useStdout } from "ink";
import { DEFAULT_TERMINAL_HEIGHT } from "../ui-constants.ts";

export function FullscreenViewport(
  { children }: PropsWithChildren,
): React.ReactElement {
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? DEFAULT_TERMINAL_HEIGHT;

  return (
    <Box
      height={terminalRows}
      flexDirection="column"
      overflow="hidden"
    >
      {children}
    </Box>
  );
}
