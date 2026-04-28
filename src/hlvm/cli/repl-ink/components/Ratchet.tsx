import React from "react";
import { useTerminalSize } from "../../../vendor/hooks/useTerminalSize.ts";
import { useTerminalViewport } from "../../../vendor/ink/hooks/use-terminal-viewport.ts";
import Box from "../../../vendor/ink/components/Box.tsx";
import type { DOMElement } from "../../../vendor/ink/dom.ts";
import measureElement from "../../../vendor/ink/measure-element.ts";

type Props = React.PropsWithChildren<{
  lock?: "always" | "offscreen";
}>;

export function Ratchet({
  children,
  lock = "always",
}: Props): React.JSX.Element {
  const [viewportRef, { isVisible }] = useTerminalViewport();
  const { rows } = useTerminalSize();
  const innerRef = React.useRef<DOMElement | null>(null);
  const maxHeight = React.useRef(0);
  const [minHeight, setMinHeight] = React.useState(0);

  const outerRef = React.useCallback((el: DOMElement | null) => {
    viewportRef(el);
  }, [viewportRef]);

  const engaged = lock === "always" || !isVisible;

  React.useLayoutEffect(() => {
    if (!innerRef.current) return;
    const { height } = measureElement(innerRef.current);
    if (height > maxHeight.current) {
      maxHeight.current = Math.min(height, rows);
      setMinHeight(maxHeight.current);
    }
  }, [rows]);

  return (
    <Box minHeight={engaged ? minHeight : undefined} ref={outerRef}>
      <Box ref={innerRef} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}
