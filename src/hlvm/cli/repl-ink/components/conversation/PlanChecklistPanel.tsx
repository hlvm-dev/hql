import React from "react";
import { Box, Text } from "ink";
import type { PlanningPhase } from "../../../../agent/planning.ts";
import type { TodoState, TodoStatus } from "../../../../agent/todo-state.ts";
import type { AgentConversationItem } from "../../types.ts";
import { useSemanticColors } from "../../../theme/index.ts";
import {
  derivePlanSurfaceState,
  getPlanPhasePlaceholder,
} from "./plan-flow.ts";

interface PlanChecklistPanelProps {
  planningPhase?: PlanningPhase;
  todoState?: TodoState;
  items?: readonly AgentConversationItem[];
}

function getPlanRowGlyph(status: TodoStatus): string {
  switch (status) {
    case "completed":
      return "✓";
    case "in_progress":
      return "»";
    case "pending":
      return "☐";
  }
}

export function PlanChecklistPanel({
  planningPhase,
  todoState,
  items = [],
}: PlanChecklistPanelProps): React.ReactElement | null {
  const sc = useSemanticColors();

  if (!planningPhase && !todoState?.items.length) {
    return null;
  }

  const planSurface = derivePlanSurfaceState({
    items,
    planningPhase,
    todoState,
  });
  const checklistItems = todoState?.items ?? [];
  const hasIncompleteSteps = checklistItems.some((item) =>
    item.status !== "completed"
  );
  const detailLine = planSurface.currentActivity ??
    (hasIncompleteSteps ? planSurface.currentStep : undefined) ??
    getPlanPhasePlaceholder(planningPhase);
  const detailText = detailLine
    ? planSurface.currentActivity ? detailLine : `Now: ${detailLine}`
    : undefined;
  const borderColor = planSurface.phaseTone === "warning"
    ? sc.status.warning
    : planSurface.phaseTone === "success"
    ? sc.status.success
    : sc.border.default;
  const titleColor = planSurface.phaseTone === "warning"
    ? sc.status.warning
    : planSurface.phaseTone === "success"
    ? sc.status.success
    : sc.text.primary;

  return (
    <Box
      marginBottom={1}
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor={borderColor}
      paddingX={1}
      flexDirection="column"
    >
      <Box>
        <Text color={titleColor} bold>{planSurface.phaseLabel}</Text>
        {planSurface.progressLabel && (
          <>
            <Text color={sc.text.secondary}>·</Text>
            <Text color={sc.text.secondary}>{planSurface.progressLabel}</Text>
          </>
        )}
      </Box>
      {detailText && (
        <Text color={sc.text.secondary} wrap="wrap">
          {detailText}
        </Text>
      )}
      {checklistItems.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          {checklistItems.map((item) => {
            const glyphColor = item.status === "completed"
              ? sc.status.success
              : item.status === "in_progress"
              ? sc.chrome.sectionLabel
              : sc.text.secondary;
            const textColor = item.status === "completed"
              ? sc.text.secondary
              : item.status === "in_progress"
              ? sc.chrome.sectionLabel
              : sc.text.primary;

            return (
              <Box key={item.id} columnGap={1}>
                <Text color={glyphColor}>{getPlanRowGlyph(item.status)}</Text>
                <Box flexShrink={1}>
                  <Text
                    color={textColor}
                    bold={item.status === "in_progress"}
                    wrap="wrap"
                  >
                    {item.content}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
