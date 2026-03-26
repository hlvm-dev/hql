import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../common/utils.ts";
import { useSemanticColors } from "../../theme/index.ts";
import type { ShellQueuePreviewLine } from "../utils/shell-chrome.ts";

interface ShellPreviewListProps {
  lines: ShellQueuePreviewLine[];
  maxWidth: number;
  marginTop?: number;
}

function renderDecoratedLine(
  line: string,
  kind: ShellQueuePreviewLine["kind"],
  sc: ReturnType<typeof useSemanticColors>,
): React.ReactElement {
  if (line.startsWith("• ")) {
    return (
      <Text>
        <Text color={sc.chrome.sectionLabel}>•</Text>
        <Text color={sc.text.primary}>{line.slice(2)}</Text>
      </Text>
    );
  }

  if (line.startsWith("↳ ")) {
    return (
      <Text>
        <Text color={sc.text.muted} dimColor>↳</Text>
        <Text color={sc.text.secondary} dimColor>{line.slice(2)}</Text>
      </Text>
    );
  }

  const color = kind === "hint" || kind === "overflow"
    ? sc.shell.queueHint
    : kind === "header"
    ? sc.text.primary
    : sc.text.secondary;
  const dimColor = kind !== "header";
  return (
    <Text color={color} dimColor={dimColor}>
      {line}
    </Text>
  );
}

export function ShellPreviewList(
  { lines, maxWidth, marginTop = 0 }: ShellPreviewListProps,
): React.ReactElement | null {
  const sc = useSemanticColors();

  if (lines.length === 0) return null;

  return (
    <Box flexDirection="column" marginTop={marginTop}>
      {lines.map((line: ShellQueuePreviewLine, index: number) => (
        <Box key={`${line.kind}-${index}`}>
          {renderDecoratedLine(
            truncate(line.text, maxWidth, "…"),
            line.kind,
            sc,
          )}
        </Box>
      ))}
    </Box>
  );
}
