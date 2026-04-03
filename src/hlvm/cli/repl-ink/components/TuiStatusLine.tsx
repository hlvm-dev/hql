import React, { useMemo } from "react";
import { Box, Text, useStdout } from "ink";
import { useSemanticColors } from "../../theme/index.ts";
import { buildContextUsageMiniBar, fitShellFooterSegments, type ShellFooterSegment, SHELL_SEGMENT_SEPARATOR, summarizeModeLabel } from "../utils/shell-chrome.ts";
import { getShellContentWidth } from "../utils/layout-tokens.ts";
import { DEFAULT_TERMINAL_WIDTH, STATUS_GLYPHS } from "../ui-constants.ts";
import type { PlanningPhase } from "../../../agent/planning.ts";
import { getPlanPhaseLabel } from "./conversation/plan-flow.ts";
import { truncate } from "../../../../common/utils.ts";

interface TuiStatusLineProps {
  modelName?: string;
  runtimeModeLabel?: string;
  contextUsageLabel?: string;
  modeLabel?: string;
  planningPhase?: PlanningPhase;
  interactionLabel?: string;
  turnLabel?: string;
  backgroundLabel?: string;
  aiAvailable?: boolean;
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

export function TuiStatusLine(
  {
    modelName,
    runtimeModeLabel,
    contextUsageLabel,
    modeLabel,
    planningPhase,
    interactionLabel,
    turnLabel,
    backgroundLabel,
    aiAvailable = false,
  }: TuiStatusLineProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  const contentWidth = getShellContentWidth(terminalWidth);

  const leftSegments = useMemo(() => {
    const segments: ShellFooterSegment[] = [];
    const summarizedMode = summarizeModeLabel(modeLabel);
    pushStatusSegment(
      segments,
      summarizedMode && summarizedMode !== "Default mode" ? summarizedMode : undefined,
      "muted",
    );
    if (planningPhase && planningPhase !== "done") {
      pushStatusSegment(segments, getPlanPhaseLabel(planningPhase), "active");
    }
    pushStatusSegment(segments, interactionLabel, "warning", true);
    pushStatusSegment(segments, turnLabel, "active");
    pushStatusSegment(
      segments,
      !turnLabel && !interactionLabel ? backgroundLabel : undefined,
      "muted",
    );
    if (segments.length === 0) {
      pushStatusSegment(segments, "Conversation ready", "muted");
    }
    return segments;
  }, [backgroundLabel, interactionLabel, modeLabel, planningPhase, turnLabel]);

  const rightParts = useMemo(() => {
    // Truncate model name individually so other parts remain intact
    const maxModelLen = 30;
    const displayModel = modelName
      ? truncate(modelName, maxModelLen)
      : undefined;
    return [
      contextUsageLabel ? buildContextUsageMiniBar(contextUsageLabel) : undefined,
      runtimeModeLabel,
      displayModel,
    ].filter((part): part is string => Boolean(part && part.trim()));
  }, [contextUsageLabel, modelName, runtimeModeLabel]);
  const rightText = rightParts.join(SHELL_SEGMENT_SEPARATOR);
  const rightWidth = rightText.length > 0 ? rightText.length + 2 : 0;
  const fittedLeft = fitShellFooterSegments(
    leftSegments,
    Math.max(10, contentWidth - rightWidth - 2),
  );

  return (
    <Box paddingLeft={1} paddingRight={1} justifyContent="space-between">
      <Box>
        {fittedLeft.map((segment, index) => {
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
                <Text color={sc.shell.separator}>{SHELL_SEGMENT_SEPARATOR}</Text>
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
      {rightText.length > 0 && (
        <Box>
          <Text color={aiAvailable ? sc.footer.status.ready : sc.footer.status.error}>
            {STATUS_GLYPHS.running}
            {" "}
          </Text>
          <Text color={sc.text.muted}>{rightText}</Text>
        </Box>
      )}
    </Box>
  );
}
