import React from "react";
import type { ShellHistoryEntry } from "../types.ts";
import { TranscriptSurface } from "./TranscriptSurface.tsx";

interface TranscriptHistoryProps {
  historyItems: ShellHistoryEntry[];
  liveItems?: Exclude<ShellHistoryEntry, { type: "hql_eval" }>[];
  width: number;
  reservedRows?: number;
  compactPlanTranscript?: boolean;
  allowToggleHotkeys?: boolean;
  expandAll?: boolean;
  interactive?: boolean;
}

export function TranscriptHistory(
  {
    historyItems,
    liveItems = [],
    width,
    reservedRows = 8,
    compactPlanTranscript = false,
    allowToggleHotkeys = true,
    expandAll = false,
    interactive = true,
  }: TranscriptHistoryProps,
): React.ReactElement | null {
  return (
    <TranscriptSurface
      historyItems={historyItems}
      liveItems={liveItems}
      width={width}
      reservedRows={reservedRows}
      compactPlanTranscript={compactPlanTranscript}
      interactive={interactive}
      allowToggleHotkeys={allowToggleHotkeys}
      expandAll={expandAll}
    />
  );
}
