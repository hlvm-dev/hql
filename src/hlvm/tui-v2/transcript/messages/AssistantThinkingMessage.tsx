import React from "react";
import Box from "../../ink/components/Box.tsx";
import Text from "../../ink/components/Text.tsx";
import { CtrlOToExpand } from "../../components/CtrlOToExpand.tsx";
import { Markdown } from "../../markdown/Markdown.tsx";

type Props = {
  thinking: string;
  kind: "thinking" | "planning";
  verbose?: boolean;
};

export function AssistantThinkingMessage({
  thinking,
  kind,
  verbose = false,
}: Props): React.ReactNode {
  if (!thinking) return null;

  const label = kind === "planning" ? "∴ Planning" : "∴ Thinking";

  if (!verbose) {
    return (
      <Box>
        <Text dimColor italic>
          {label} <CtrlOToExpand />
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Text dimColor italic>
        {label}…
      </Text>
      <Box paddingLeft={2}>
        <Markdown children={thinking} />
      </Box>
    </Box>
  );
}
