import React from "react";
import Box from "../../../vendor/ink/components/Box.tsx";
import ScrollBox, {
  type ScrollBoxHandle,
} from "../../../vendor/ink/components/ScrollBox.tsx";

type Props = {
  scrollRef: React.RefObject<ScrollBoxHandle | null>;
  scrollable: React.ReactNode;
  bottom: React.ReactNode;
  overlay?: React.ReactNode;
};

/**
 * Donor-shaped fullscreen shell:
 * - transcript owns the flex-grow region
 * - prompt / search / permission chrome stays pinned in the bottom slot
 * - no fixed transcript height, so scrolling is owned by ScrollBox
 */
export function FullscreenLayout({
  scrollRef,
  scrollable,
  bottom,
  overlay,
}: Props): React.ReactNode {
  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <ScrollBox
        ref={scrollRef}
        flexGrow={1}
        flexDirection="column"
        stickyScroll
      >
        {scrollable}
        {overlay}
      </ScrollBox>
      <Box
        flexDirection="column"
        flexShrink={0}
        width="100%"
        overflowY="hidden"
      >
        {bottom}
      </Box>
    </Box>
  );
}
