import { useMemo } from "react";
import type {
  PromptInputMode,
  QueuedCommand,
} from "../types/textInputTypes.ts";

type Props = {
  input: string;
  mode: PromptInputMode;
  submitCount: number;
  queuedCommands: QueuedCommand[];
  viewingAgentName?: string;
};

const MAX_TEAMMATE_NAME_LENGTH = 20;

export function usePromptInputPlaceholder({
  input,
  mode,
  submitCount,
  queuedCommands,
  viewingAgentName,
}: Props): string | undefined {
  return useMemo(() => {
    if (input !== "") {
      return;
    }

    if (viewingAgentName) {
      const displayName = viewingAgentName.length > MAX_TEAMMATE_NAME_LENGTH
        ? viewingAgentName.slice(0, MAX_TEAMMATE_NAME_LENGTH - 3) + "..."
        : viewingAgentName;
      return `Message @${displayName}...`;
    }

    if (queuedCommands.length > 0) {
      return "Press up to edit queued messages";
    }

    if (mode === "bash") {
      return;
    }

    if (submitCount < 1) {
      return;
    }

    return;
  }, [input, mode, queuedCommands, submitCount, viewingAgentName]);
}
