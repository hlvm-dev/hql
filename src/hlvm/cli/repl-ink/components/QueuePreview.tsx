/**
 * QueuePreview Component
 *
 * Renders queued conversation drafts using the same explicit section shape as
 * Codex's queued follow-up preview.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { truncate } from "../../../../common/utils.ts";
import { useSemanticColors } from "../../theme/index.ts";
import {
  type ConversationComposerDraft,
  getConversationDraftPreview,
} from "../utils/conversation-queue.ts";
import { DEFAULT_TERMINAL_WIDTH } from "../ui-constants.ts";

const MAX_VISIBLE_ITEMS = 3;
const PREVIEW_LENGTH = 72;

export interface QueuePreviewLine {
  kind: "header" | "item" | "ellipsis" | "hint";
  text: string;
}

export interface QueuePreviewProps {
  items: ConversationComposerDraft[];
  editBindingLabel: string;
}

export function buildQueuePreviewLines(
  items: ConversationComposerDraft[],
  editBindingLabel: string,
): QueuePreviewLine[] {
  if (items.length === 0) return [];

  const lines: QueuePreviewLine[] = [{
    kind: "header",
    text: "Queued:",
  }];

  const visibleItems = items.slice(0, MAX_VISIBLE_ITEMS);
  for (let i = 0; i < visibleItems.length; i++) {
    lines.push({
      kind: "item",
      text: `  ${i + 1}. ${
        truncate(getConversationDraftPreview(visibleItems[i]), PREVIEW_LENGTH)
      }`,
    });
  }

  if (items.length > visibleItems.length) {
    lines.push({
      kind: "ellipsis",
      text: "    \u2026",
    });
  }

  lines.push({
    kind: "hint",
    text: `    ${editBindingLabel} edit last queued message`,
  });

  return lines;
}

export function QueuePreview({
  items,
  editBindingLabel,
}: QueuePreviewProps): React.ReactElement | null {
  const { stdout } = useStdout();
  const sc = useSemanticColors();
  const lines = buildQueuePreviewLines(items, editBindingLabel);
  const maxWidth = Math.max(
    20,
    (stdout?.columns ?? DEFAULT_TERMINAL_WIDTH) - 4,
  );

  if (lines.length === 0) return null;

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => {
        const color = line.kind === "header" ? sc.text.primary : sc.text.muted;
        const dimColor = line.kind !== "header";
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
}
