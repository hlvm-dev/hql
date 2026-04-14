import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../common/utils.ts";
import { useSemanticColors } from "../../theme/index.ts";

const MAX_RAIL_ROWS = 3;

type RailTone = "active" | "warning" | "muted" | "error" | "success";

interface RailRow {
  text: string;
  tone: RailTone;
}

interface CurrentTurnRailItem {
  text: string;
  tone: RailTone;
}

export function buildActivityRailRows(input: {
  currentTurn?: CurrentTurnRailItem;
  width: number;
}): { rows: RailRow[]; overflow?: string } | null {
  const rows: RailRow[] = [];

  if (input.currentTurn?.text.trim()) {
    rows.push({
      text: `turn \u00B7 ${input.currentTurn.text.trim()}`,
      tone: input.currentTurn.tone,
    });
  }

  if (rows.length === 0) return null;

  const visibleRows = rows.slice(0, MAX_RAIL_ROWS).map((row) => ({
    ...row,
    text: truncate(row.text, Math.max(24, input.width)),
  }));
  const overflow = rows.length > MAX_RAIL_ROWS
    ? truncate(`+${rows.length - MAX_RAIL_ROWS} more`, Math.max(12, input.width))
    : undefined;
  return { rows: visibleRows, overflow };
}

interface ActivityRailProps {
  currentTurn?: CurrentTurnRailItem;
  width: number;
}

export function ActivityRail(
  props: ActivityRailProps,
): React.ReactElement | null {
  const sc = useSemanticColors();
  const model = buildActivityRailRows(props);

  if (!model) return null;

  const colorForTone = (tone: RailTone): string => {
    switch (tone) {
      case "error":
        return sc.status.error;
      case "warning":
        return sc.status.warning;
      case "success":
        return sc.status.success;
      case "active":
        return sc.text.primary;
      case "muted":
      default:
        return sc.text.muted;
    }
  };

  return (
    <Box flexDirection="column" marginTop={0} marginBottom={0}>
      {model.rows.map((row) => (
        <Text color={colorForTone(row.tone)}>
          {row.text}
        </Text>
      ))}
      {model.overflow && <Text color={sc.text.muted}>{model.overflow}</Text>}
    </Box>
  );
}
