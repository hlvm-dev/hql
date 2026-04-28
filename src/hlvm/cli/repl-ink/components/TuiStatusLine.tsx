import React, { useMemo } from "react";
import { Box, Text, useStdout } from "ink";
import { useSemanticColors } from "../../theme/index.ts";
import {
  buildContextUsageMiniBar,
  fitShellFooterSegments,
  SHELL_SEGMENT_SEPARATOR,
  type ShellFooterSegment,
  summarizeModeLabel,
} from "../utils/shell-chrome.ts";
import { getShellContentWidth } from "../utils/layout-tokens.ts";
import { DEFAULT_TERMINAL_WIDTH, STATUS_GLYPHS } from "../ui-constants.ts";
import type { PlanningPhase } from "../../../agent/planning.ts";
import { getPlanPhaseLabel } from "./conversation/plan-flow.ts";
import { truncate } from "../../../../common/utils.ts";
import { stringWidth } from "../../../vendor/ink/stringWidth.ts";

interface TuiStatusLineProps {
  modelName?: string;
  contextUsageLabel?: string;
  modeLabel?: string;
  planningPhase?: PlanningPhase;
  interactionLabel?: string;
  turnLabel?: string;
  turnTone?: "active" | "warning";
  aiAvailable?: boolean;
  idleLabel?: string;
}

function pushStatusSegment(
  segments: ShellFooterSegment[],
  text: string | undefined,
  tone: ShellFooterSegment["tone"],
  chip = false,
): void {
  const trimmed = text?.trim();
  if (!trimmed) return;
  segments.push({ text: trimmed, tone, chip });
}

/** Measure the character width of joined parts with separators + the "● " prefix. */
function measureRightParts(parts: string[]): number {
  if (parts.length === 0) return 0;
  const joined = parts.join(SHELL_SEGMENT_SEPARATOR);
  return stringWidth(joined) + 2; // +2 for "● " prefix
}

export function TuiStatusLine(
  {
    modelName,
    contextUsageLabel,
    modeLabel,
    planningPhase,
    interactionLabel,
    turnLabel,
    turnTone = "active",
    aiAvailable = false,
    idleLabel,
  }: TuiStatusLineProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  const contentWidth = getShellContentWidth(terminalWidth);
  const hasPrimaryActivity = Boolean(
    interactionLabel?.trim() || turnLabel?.trim(),
  );
  const idleStatus = idleLabel?.trim() || "Ready";
  const isStartupState = idleStatus !== "Ready";

  const leftSegments = useMemo(() => {
    const segments: ShellFooterSegment[] = [];
    const summarizedMode = summarizeModeLabel(modeLabel);
    if (!hasPrimaryActivity) {
      pushStatusSegment(
        segments,
        summarizedMode && summarizedMode !== "Default mode"
          ? summarizedMode
          : undefined,
        "muted",
      );
      if (planningPhase && planningPhase !== "done") {
        pushStatusSegment(segments, getPlanPhaseLabel(planningPhase), "active");
      }
    }
    pushStatusSegment(segments, interactionLabel, "warning", true);
    pushStatusSegment(segments, turnLabel, turnTone);
    if (segments.length === 0) {
      pushStatusSegment(segments, idleStatus, "muted");
    }
    return segments;
  }, [
    idleStatus,
    interactionLabel,
    modeLabel,
    planningPhase,
    turnLabel,
    turnTone,
  ]);

  // Build right-side parts: [ctxBar, modelName]
  // Model name is truncated dynamically to fill remaining terminal width.
  const { rightText, rightWidth, fittedLeft } = useMemo(() => {
    // Fixed parts (ctx bar) — never truncated
    const fixedParts = hasPrimaryActivity || isStartupState || !aiAvailable
      ? []
      : [
        contextUsageLabel
          ? buildContextUsageMiniBar(contextUsageLabel)
          : undefined,
      ].filter((part): part is string => Boolean(part && part.trim()));

    // Measure fixed parts width (including "● " prefix and separators)
    const fixedWidth = measureRightParts(fixedParts);

    // Model name gets whatever width remains after left + fixed right + gap
    const leftMinWidth = 10;
    const gap = 3;
    const separatorExtra = fixedParts.length > 0
      ? SHELL_SEGMENT_SEPARATOR.length
      : 0;
    const modelBudget = contentWidth - leftMinWidth - gap - fixedWidth -
      separatorExtra;

    const displayModel = !hasPrimaryActivity && modelName && modelBudget > 8
      ? truncate(modelName, modelBudget)
      : !hasPrimaryActivity && modelName && modelBudget > 0
      ? truncate(modelName, modelBudget)
      : undefined;

    const allParts = [...fixedParts];
    if (displayModel) allParts.push(displayModel);

    const joined = allParts.join(SHELL_SEGMENT_SEPARATOR);
    const width = allParts.length > 0 ? stringWidth(joined) + 2 : 0;

    const fitted = fitShellFooterSegments(
      leftSegments,
      Math.max(10, contentWidth - width - gap),
    );

    return { rightText: joined, rightWidth: width, fittedLeft: fitted };
  }, [
    contentWidth,
    contextUsageLabel,
    hasPrimaryActivity,
    isStartupState,
    leftSegments,
    modelName,
    aiAvailable,
  ]);

  return (
    <Box paddingLeft={1} paddingRight={1} justifyContent="space-between">
      <Box>
        {fittedLeft.map((segment: ShellFooterSegment, index: number) => {
          const color = segment.tone === "warning"
            ? sc.status.warning
            : segment.tone === "active"
            ? sc.footer.status.active
            : segment.tone === "error"
            ? sc.status.error
            : sc.text.muted;
          const chipColors = segment.tone === "warning"
            ? sc.chrome.chipWarning
            : segment.tone === "active"
            ? sc.chrome.chipActive
            : sc.chrome.chipNeutral;
          return (
            <React.Fragment key={`${segment.text}-${index}`}>
              {index > 0 && (
                <Text color={sc.shell.separator}>
                  {SHELL_SEGMENT_SEPARATOR}
                </Text>
              )}
              {segment.chip
                ? (
                  <Text
                    backgroundColor={chipColors.background}
                    color={chipColors.foreground}
                  >
                    {" "}
                    {segment.text}
                    {" "}
                  </Text>
                )
                : <Text color={color}>{segment.text}</Text>}
            </React.Fragment>
          );
        })}
      </Box>
      {rightWidth > 0 && (
        <Box>
          <Text
            color={aiAvailable
              ? sc.footer.status.ready
              : sc.footer.status.error}
          >
            {STATUS_GLYPHS.running}
            {" "}
          </Text>
          <Text color={sc.text.muted}>{rightText}</Text>
        </Box>
      )}
    </Box>
  );
}
