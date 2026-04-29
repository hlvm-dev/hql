/**
 * FullscreenViewport — constrains the REPL to the terminal viewport.
 */

import React, { type PropsWithChildren } from "react";
import { Box } from "ink";

export function FullscreenViewport(
  { children }: PropsWithChildren,
): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      width="100%"
    >
      {children}
    </Box>
  );
}
