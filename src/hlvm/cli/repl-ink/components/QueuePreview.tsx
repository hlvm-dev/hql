/**
 * QueuePreview Component
 *
 * Renders one ordered foreground queue. Item type is shown inline, but the
 * shell no longer splits chat/eval into separate queue lanes.
 */

import React, { useMemo } from "react";
import { useStdout } from "ink";
import { truncate } from "../../../../common/utils.ts";
import {
  type ConversationComposerDraft,
  getConversationDraftPreview,
  getQueuedDraftKind,
} from "../utils/conversation-queue.ts";
import { DEFAULT_TERMINAL_WIDTH } from "../ui-constants.ts";
import {
  buildMixedQueuePreviewHeaderLine,
  buildMixedQueuePreviewItemLine,
  buildMixedQueuePreviewOverflowLine,
  buildQueuePreviewHintLine,
  type ShellQueuePreviewLine,
} from "../utils/shell-chrome.ts";
import { ShellPreviewList } from "./ShellPreviewList.tsx";

const MAX_VISIBLE_ITEMS = 3;
const PREVIEW_LENGTH = 72;

export interface QueuePreviewProps {
  items: ConversationComposerDraft[];
  editBindingLabel: string;
}

export function buildQueuePreviewLines(
  items: ConversationComposerDraft[],
  editBindingLabel: string,
): ShellQueuePreviewLine[] {
  if (items.length === 0) return [];

  const lines: ShellQueuePreviewLine[] = [buildMixedQueuePreviewHeaderLine()];
  const visibleItems = items.slice(0, MAX_VISIBLE_ITEMS);

  for (const item of visibleItems) {
    lines.push(
      buildMixedQueuePreviewItemLine(
        getQueuedDraftKind(item),
        truncate(getConversationDraftPreview(item), PREVIEW_LENGTH),
      ),
    );
  }

  if (items.length > visibleItems.length) {
    lines.push(
      buildMixedQueuePreviewOverflowLine(items.length - visibleItems.length),
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
