/**
 * QueuePreview Component
 *
 * Renders queued conversation drafts using the same explicit section shape as
 * Codex's queued follow-up preview.
 */

import React, { useMemo } from "react";
import { useStdout } from "ink";
import { truncate } from "../../../../common/utils.ts";
import {
  type ConversationComposerDraft,
  getConversationDraftPreview,
} from "../utils/conversation-queue.ts";
import { DEFAULT_TERMINAL_WIDTH } from "../ui-constants.ts";
import {
  buildQueuePreviewHeaderLine,
  buildQueuePreviewHintLine,
  buildQueuePreviewItemLine,
  buildQueuePreviewOverflowCountLine,
  type ShellQueuePreviewLine,
} from "../utils/shell-chrome.ts";
import { ShellPreviewList } from "./ShellPreviewList.tsx";

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
        truncate(getConversationDraftPreview(visibleItems[i]), PREVIEW_LENGTH),
      ),
    );
  }

  if (items.length > visibleItems.length) {
    lines.push(
      buildQueuePreviewOverflowCountLine(items.length - visibleItems.length),
    );
  }

  lines.push(buildQueuePreviewHintLine(editBindingLabel));

  return lines;
}

export const QueuePreview = React.memo(function QueuePreview({
  items,
  editBindingLabel,
}: QueuePreviewProps): React.ReactElement | null {
  const { stdout } = useStdout();
  const lines = useMemo(
    () => buildQueuePreviewLines(items, editBindingLabel),
    [items, editBindingLabel],
  );
  const maxWidth = Math.max(
    20,
    (stdout?.columns ?? DEFAULT_TERMINAL_WIDTH) - 4,
  );

  if (lines.length === 0) return null;

  return <ShellPreviewList lines={lines} maxWidth={maxWidth} />;
});
