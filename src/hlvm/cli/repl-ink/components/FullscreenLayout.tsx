import React from "react";
import { Box } from "ink";

type Props = {
  scrollable: React.ReactNode;
  bottom: React.ReactNode;
  overlay?: React.ReactNode;
};

export function FullscreenLayout({
  scrollable,
  bottom,
  overlay,
}: Props): React.ReactNode {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {scrollable}
      {overlay}
      <Box
        flexDirection="column"
        flexShrink={0}
        width="100%"
      >
        {bottom}
      </Box>
    </Box>
  );
}
