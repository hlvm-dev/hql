import React from "react";
import type { PlanningPhase } from "../../../agent/planning.ts";
import type { TodoState } from "../../../agent/todo-state.ts";
import {
  type AgentConversationItem,
  type StreamingState,
} from "../types.ts";
import { TranscriptSurface } from "./TranscriptSurface.tsx";

interface PendingTurnPanelProps {
  items: AgentConversationItem[];
  width: number;
  streamingState?: StreamingState;
  planningPhase?: PlanningPhase;
  todoState?: TodoState;
  compactSpacing?: boolean;
  showLeadingDivider?: boolean;
  allowToggleHotkeys?: boolean;
}

export function PendingTurnPanel(
  {
    items,
    width,
    streamingState,
    planningPhase,
    todoState,
    compactSpacing = false,
    showLeadingDivider = false,
    allowToggleHotkeys = true,
  }: PendingTurnPanelProps,
): React.ReactElement | null {
  return (
    <TranscriptSurface
      liveItems={items}
      width={width}
      compactSpacing={compactSpacing}
      allowToggleHotkeys={allowToggleHotkeys}
      streamingState={streamingState}
      planningPhase={planningPhase}
      todoState={todoState}
      showPlanChecklist
      showLeadingDivider={showLeadingDivider}
    />
  );
}
