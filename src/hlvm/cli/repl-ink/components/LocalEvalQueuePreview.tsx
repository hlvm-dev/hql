import React from "react";
import { truncate } from "../../../../common/utils.ts";
import type { QueuedLocalEval } from "../types.ts";
import {
  buildLocalEvalPreviewHeaderLine,
  buildLocalEvalPreviewItemLine,
  buildLocalEvalPreviewOverflowLine,
  type ShellQueuePreviewLine,
} from "../utils/shell-chrome.ts";
import { ShellPreviewList } from "./ShellPreviewList.tsx";

interface LocalEvalQueuePreviewProps {
  items: QueuedLocalEval[];
  width: number;
}

const MAX_VISIBLE_ITEMS = 3;
const PREVIEW_LENGTH = 72;

export function buildLocalEvalQueuePreviewLines(
  items: QueuedLocalEval[],
  width: number,
): ShellQueuePreviewLine[] {
  if (items.length === 0) return [];

  const lines: ShellQueuePreviewLine[] = [
    buildLocalEvalPreviewHeaderLine(items.length),
  ];
  const previewWidth = Math.max(12, Math.min(PREVIEW_LENGTH, width - 4));
  const visibleItems = items.slice(0, MAX_VISIBLE_ITEMS);
  for (const item of visibleItems) {
    lines.push(
      buildLocalEvalPreviewItemLine(
        truncate(item.input, previewWidth, "…"),
      ),
    );
  }
  if (items.length > visibleItems.length) {
    lines.push(
      buildLocalEvalPreviewOverflowLine(items.length - visibleItems.length),
    );
  }
  return lines;
}

export function LocalEvalQueuePreview(
  { items, width }: LocalEvalQueuePreviewProps,
): React.ReactElement | null {
  const lines = buildLocalEvalQueuePreviewLines(items, width);
  return (
    <ShellPreviewList
      lines={lines}
      maxWidth={Math.max(12, width)}
      marginTop={1}
    />
  );
}
