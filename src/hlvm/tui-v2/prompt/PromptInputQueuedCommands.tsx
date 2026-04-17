import React from "react";
import { truncate } from "../../../common/utils.ts";
import { getPlatform } from "../../../platform/platform.ts";
import {
  getConversationDraftPreview,
  getConversationQueueEditBinding,
  getConversationQueueEditBindingLabel,
  getQueuedDraftKind,
  type QueuedInputKind,
} from "../../cli/repl-ink/utils/conversation-queue.ts";
import {
  buildMixedQueuePreviewHeaderLine,
  buildMixedQueuePreviewItemLine,
  buildMixedQueuePreviewOverflowLine,
  buildQueuePreviewHintLine,
  type ShellQueuePreviewLine,
} from "../../cli/repl-ink/utils/shell-chrome.ts";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import { DONOR_INACTIVE } from "../theme/donorTheme.ts";
import type { QueuedCommand } from "../types/textInputTypes.ts";

type Props = {
  queuedCommands: QueuedCommand[];
};

const MAX_VISIBLE_ITEMS = 3;
const PREVIEW_LENGTH = 72;

function renderPreviewLine(
  line: ShellQueuePreviewLine,
): React.ReactElement {
  if (line.text.startsWith("• ")) {
    return (
      <Text>
        <Text color="white">•</Text>
        <Text color="white">{line.text.slice(2)}</Text>
      </Text>
    );
  }

  if (line.text.startsWith("↳ ")) {
    return (
      <Text>
        <Text color={DONOR_INACTIVE} dimColor>↳</Text>
        <Text color={DONOR_INACTIVE} dimColor>{line.text.slice(2)}</Text>
      </Text>
    );
  }

  const color = line.kind === "header" ? "white" : DONOR_INACTIVE;
  return (
    <Text color={color} dimColor={line.kind !== "header"}>
      {line.text}
    </Text>
  );
}

function buildQueuePreviewLines(
  queuedCommands: readonly QueuedCommand[],
): ShellQueuePreviewLine[] {
  if (queuedCommands.length === 0) {
    return [];
  }

  const editBindingLabel = getConversationQueueEditBindingLabel(
    getConversationQueueEditBinding(getPlatform().env),
  );
  const visibleCommands = queuedCommands.slice(0, MAX_VISIBLE_ITEMS);
  const lines: ShellQueuePreviewLine[] = [buildMixedQueuePreviewHeaderLine()];

  for (const command of visibleCommands) {
    const draft = {
      text: command.value,
      attachments: command.attachments ?? [],
      cursorOffset: command.cursorOffset ?? command.value.length,
      queuedKind: command.mode === "bash"
        ? "command" as QueuedInputKind
        : undefined,
    };
    lines.push(
      buildMixedQueuePreviewItemLine(
        getQueuedDraftKind(draft),
        truncate(getConversationDraftPreview(draft), PREVIEW_LENGTH, "…"),
      ),
    );
  }

  if (queuedCommands.length > visibleCommands.length) {
    lines.push(
      buildMixedQueuePreviewOverflowLine(
        queuedCommands.length - visibleCommands.length,
      ),
    );
  }

  lines.push(buildQueuePreviewHintLine(editBindingLabel));
  return lines;
}

export function PromptInputQueuedCommands(
  { queuedCommands }: Props,
): React.ReactNode {
  const lines = React.useMemo(
    () => buildQueuePreviewLines(queuedCommands),
    [queuedCommands],
  );

  if (lines.length === 0) {
    return null;
  }

  return (
    <Box marginBottom={1} flexDirection="column">
      {lines.map((line, index) => (
        <Box key={`${line.kind}-${index}`}>
          {renderPreviewLine(line)}
        </Box>
      ))}
    </Box>
  );
}
