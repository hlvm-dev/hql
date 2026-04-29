import React from "react";
import { Box } from "ink";
import ScrollBox, {
  type ScrollBoxHandle,
  type ScrollBoxSnapshot,
} from "./ScrollBox.tsx";

type Props = {
  scrollRef: React.RefObject<ScrollBoxHandle | null>;
  scrollable: React.ReactNode;
  bottom: React.ReactNode;
  overlay?: React.ReactNode;
  onScrollStateChange?: (snapshot: ScrollBoxSnapshot) => void;
  nativeScroll?: boolean;
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
  onScrollStateChange,
  nativeScroll = false,
}: Props): React.ReactNode {
  if (nativeScroll) {
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

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <ScrollBox
        ref={scrollRef}
        flexGrow={1}
        flexDirection="column"
        stickyScroll
        onScrollStateChange={onScrollStateChange}
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
