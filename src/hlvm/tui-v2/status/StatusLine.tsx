import React from "react";
import Text from "../ink/components/Text.tsx";
import type { PromptInputMode } from "../types/textInputTypes.ts";
import { DONOR_INACTIVE } from "../theme/donorTheme.ts";

type Props = {
  modeLabel: string;
  promptMode: PromptInputMode;
  selected: string;
  searchCurrent: number;
  searchCount: number;
  stickyPrompt: string;
  modelLabel?: string;
  streamingLabel?: string;
  activityLabel?: string;
  activeToolLabel?: string;
  footerLabel?: string;
  queuedCount?: number;
  historyCount?: number;
  permissionLabel?: string;
};

function joinSegments(
  segments: Array<string | undefined | false>,
): string {
  return segments.filter((segment): segment is string => Boolean(segment)).join(
    " · ",
  );
}

export function StatusLine({
  modeLabel,
  promptMode,
  selected,
  searchCurrent,
  searchCount,
  stickyPrompt,
  modelLabel,
  streamingLabel,
  activityLabel,
  activeToolLabel,
  footerLabel,
  queuedCount = 0,
  historyCount = 0,
  permissionLabel,
}: Props): React.ReactNode {
  const line = joinSegments([
    modelLabel ? `model ${modelLabel}` : undefined,
    streamingLabel && streamingLabel !== "idle"
      ? `stream ${streamingLabel}`
      : undefined,
    activityLabel ? activityLabel : undefined,
    activeToolLabel ? `tool ${activeToolLabel}` : undefined,
    searchCount > 0 || searchCurrent > 0
      ? `search ${searchCurrent}/${searchCount}`
      : undefined,
    queuedCount > 0 ? `queued ${queuedCount}` : undefined,
    historyCount > 0 ? `history ${historyCount}` : undefined,
    promptMode !== "prompt" ? `mode ${promptMode}` : undefined,
    modeLabel !== "transcript" ? `pane ${modeLabel}` : undefined,
    selected !== "none" ? selected : undefined,
    stickyPrompt !== "none" ? stickyPrompt : undefined,
    footerLabel ? footerLabel : undefined,
    permissionLabel ? permissionLabel : undefined,
  ]);

  if (line.length === 0) return null;

  return <Text color={DONOR_INACTIVE} wrap="truncate-end">{line}</Text>;
}
