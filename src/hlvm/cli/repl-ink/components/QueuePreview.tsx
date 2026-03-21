/**
 * QueuePreview Component
 *
 * Renders queued conversation drafts using the same explicit section shape as
 * Codex's queued follow-up preview.
 */

import React, { useMemo } from "react";
import { Box, Text, useStdout } from "ink";
import { truncate } from "../../../../common/utils.ts";
import { useSemanticColors } from "../../theme/index.ts";
import {
  type ConversationComposerDraft,
  getConversationDraftPreview,
} from "../utils/conversation-queue.ts";
import { DEFAULT_TERMINAL_WIDTH } from "../ui-constants.ts";
import {
  buildQueuePreviewHeaderLine,
  buildQueuePreviewHintLine,
  buildQueuePreviewItemLine,
  buildQueuePreviewOverflowLine,
  type ShellQueuePreviewLine,
} from "../utils/shell-chrome.ts";

const MAX_VISIBLE_ITEMS = 3;
const PREVIEW_LENGTH = 72;
export type QueuePreviewLine = ShellQueuePreviewLine;

export interface QueuePreviewProps {
  items: ConversationComposerDraft[];
  editBindingLabel: string;
}

export function buildQueuePreviewLines(
  items: ConversationComposerDraft[],
  editBindingLabel: string,
): QueuePreviewLine[] {
  if (items.length === 0) return [];

  const lines: QueuePreviewLine[] = [buildQueuePreviewHeaderLine()];

  const visibleItems = items.slice(0, MAX_VISIBLE_ITEMS);
  for (let i = 0; i < visibleItems.length; i++) {
    lines.push(
      buildQueuePreviewItemLine(
        i,
        truncate(getConversationDraftPreview(visibleItems[i]), PREVIEW_LENGTH),
      ),
    );
  }

  if (items.length > visibleItems.length) {
    lines.push(buildQueuePreviewOverflowLine());
  }

  lines.push(buildQueuePreviewHintLine(editBindingLabel));

  return lines;
}

export const QueuePreview = React.memo(function QueuePreview({
  items,
  editBindingLabel,
}: QueuePreviewProps): React.ReactElement | null {
  const { stdout } = useStdout();
  const sc = useSemanticColors();
  const lines = useMemo(
    () => buildQueuePreviewLines(items, editBindingLabel),
    [items, editBindingLabel],
  );
  const maxWidth = Math.max(
    20,
    (stdout?.columns ?? DEFAULT_TERMINAL_WIDTH) - 4,
  );

  if (lines.length === 0) return null;

  return (
    <Box flexDirection="column">
      {lines.map((line: QueuePreviewLine, index: number) => {
        if (line.chip) {
          return (
            <Box key={`${line.kind}-${index}`}>
              <Text
                backgroundColor={sc.shell.chipNeutral.background}
                color={sc.shell.chipNeutral.foreground}
              >
                {" "}
                {truncate(line.text, maxWidth, "…")}
                {" "}
              </Text>
            </Box>
          );
        }

        const color = line.tone === "hint"
          ? sc.shell.queueHint
          : line.tone === "neutral"
          ? sc.text.primary
          : sc.text.secondary;
        const dimColor = line.tone !== "neutral";
        return (
          <Box key={`${line.kind}-${index}`}>
            <Text color={color} dimColor={dimColor}>
              {truncate(line.text, maxWidth, "…")}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
});
