import React from "react";
import { Box, type DOMElement, measureElement, useWindowSize } from "ink";

type Props = React.PropsWithChildren<{
  lock?: "always" | "offscreen";
}>;

/**
 * Ratchet — locks min-height to the largest size content has reached so
 * shrinking doesn't cause jitter. Upstream Ink has no viewport-visibility
 * hook so the "offscreen" lock degrades to "always" — fine in practice
 * since the only consumer renders inside the visible composer surface.
 */
export function Ratchet({
  children,
}: Props): React.JSX.Element {
  const { rows } = useWindowSize();
  const innerRef = React.useRef<DOMElement | null>(null);
  const maxHeight = React.useRef(0);
  const [minHeight, setMinHeight] = React.useState(0);

  React.useLayoutEffect(() => {
    if (!innerRef.current) return;
    const { height } = measureElement(innerRef.current);
    if (height > maxHeight.current) {
      maxHeight.current = Math.min(height, rows);
      setMinHeight(maxHeight.current);
    }
  }, [rows]);

  return (
    <Box minHeight={minHeight}>
      <Box ref={innerRef} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}
