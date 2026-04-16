import React from "react";
import Box from "../../ink/components/Box.tsx";
import Text from "../../ink/components/Text.tsx";
import { CtrlOToExpand } from "../../components/CtrlOToExpand.tsx";

type Props = {
  title: string;
  lines: string[];
  verbose?: boolean;
};

export function SystemTextMessage(
  { title, lines, verbose = false }: Props,
): React.ReactNode {
  const shownLines = verbose ? lines : lines.slice(0, 1);
  return (
    <Box flexDirection="column">
      <Text dimColor>{title}</Text>
      {shownLines.map((line, index) => (
        <Text key={index} dimColor wrap="wrap">
          {line}
        </Text>
      ))}
      {!verbose && lines.length > 1 && <CtrlOToExpand />}
    </Box>
  );
}
