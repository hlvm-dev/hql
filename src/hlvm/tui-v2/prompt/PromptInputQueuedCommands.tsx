import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import type { QueuedCommand } from "../types/textInputTypes.ts";
import { prependModeCharacterToInput } from "./inputModes.ts";

type Props = {
  queuedCommands: QueuedCommand[];
};

function summarize(value: string): string {
  return value.length > 72 ? `${value.slice(0, 69)}...` : value;
}

export function PromptInputQueuedCommands(
  { queuedCommands }: Props,
): React.ReactNode {
  if (queuedCommands.length === 0) {
    return null;
  }

  const visibleCommands = queuedCommands.slice(-3);

  return (
    <Box marginBottom={1} flexDirection="column">
      <Text dimColor>Queued commands</Text>
      {visibleCommands.map((command) => (
        <Text key={command.id} dimColor wrap="wrap">
          {summarize(
            prependModeCharacterToInput(
              command.value,
              command.mode === "task-notification" ? "prompt" : command.mode,
            ),
          )}
        </Text>
      ))}
      {queuedCommands.length > visibleCommands.length && (
        <Text dimColor>
          +{queuedCommands.length - visibleCommands.length} more queued
        </Text>
      )}
    </Box>
  );
}
