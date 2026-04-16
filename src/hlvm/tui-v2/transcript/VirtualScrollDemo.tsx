import React from "react";
import { useTerminalSize } from "../hooks/useTerminalSize.ts";
import { useVirtualScroll } from "../hooks/useVirtualScroll.ts";
import ScrollBox, { type ScrollBoxHandle } from "../ink/components/ScrollBox.tsx";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";

type DemoItem = {
  id: string;
  title: string;
  lines: string[];
};

function buildDemoItems(): DemoItem[] {
  return Array.from({ length: 240 }, (_, index) => {
    const extra = index % 5;
    const lines = Array.from({ length: 1 + extra }, (_, lineIndex) =>
      `row ${index.toString().padStart(3, "0")} · body line ${
        lineIndex + 1
      } · virtualization donor prework`,
    );
    return {
      id: `demo-${index}`,
      title: `Renderable item ${index.toString().padStart(3, "0")}`,
      lines,
    };
  });
}

export function VirtualScrollDemo(): React.ReactNode {
  const items = React.useMemo(() => buildDemoItems(), []);
  const itemKeys = React.useMemo(() => items.map((item) => item.id), [items]);
  const scrollRef = React.useRef<ScrollBoxHandle | null>(null);
  const { columns } = useTerminalSize();
  const effectiveColumns = Math.max(24, columns - 8);

  const {
    range,
    topSpacer,
    bottomSpacer,
    measureRef,
    spacerRef,
    scrollToIndex,
  } = useVirtualScroll(scrollRef, itemKeys, effectiveColumns);

  const [start, end] = range;
  const bootstrappedRef = React.useRef(false);

  React.useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    const timer = setTimeout(() => scrollToIndex(120), 60);
    return () => clearTimeout(timer);
  }, [scrollToIndex]);

  return (
    <Box flexDirection="column">
      <Text bold>Transcript virtualization donor core</Text>
      <Text dim>
        This is donor `useVirtualScroll` running against synthetic transcript rows.
      </Text>
      <Text dim>
        mounted range [{start}, {end}) of {items.length} · top spacer {topSpacer} ·
        {" "}bottom spacer {bottomSpacer}
      </Text>
      <Box borderStyle="round" marginTop={1} paddingX={1} height={14}>
        <ScrollBox ref={scrollRef} flexDirection="column" height={12}>
          <Box ref={spacerRef} height={topSpacer} flexShrink={0} />
          {items.slice(start, end).map((item, localIndex) => {
            const index = start + localIndex;
            return (
              <Box
                key={item.id}
                ref={measureRef(item.id)}
                flexDirection="column"
                borderStyle="single"
                marginBottom={1}
                paddingX={1}
                flexShrink={0}
              >
                <Text bold>{index.toString().padStart(3, "0")} · {item.title}</Text>
                {item.lines.map((line, lineIndex) => (
                  <Text key={`${item.id}-${lineIndex}`} wrap="wrap">
                    {line}
                  </Text>
                ))}
              </Box>
            );
          })}
          {bottomSpacer > 0 && <Box height={bottomSpacer} flexShrink={0} />}
        </ScrollBox>
      </Box>
    </Box>
  );
}
