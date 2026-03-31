/**
 * Footer Component
 *
 * Single-line Codex-style footer:
 * - Left: context-aware status / action hints
 * - Right: model name + optional context usage
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { useSemanticColors } from "../../theme/index.ts";
import type { PlanningPhase } from "../../../agent/planning.ts";
import {
  type StreamingState,
  StreamingState as ConversationStreamingState,
} from "../types.ts";
import { DEFAULT_TERMINAL_WIDTH, STATUS_GLYPHS } from "../ui-constants.ts";
import { getShellContentWidth } from "../utils/layout-tokens.ts";

import { truncate } from "../../../../common/utils.ts";
import { getPlanPhaseLabel } from "./conversation/plan-flow.ts";
import {
  buildContextUsageMiniBar,
  fitShellFooterSegments,
  formatShellFooterText,
  SHELL_SEGMENT_SEPARATOR,
  type ShellFooterSegment,
  summarizeModeLabel,
} from "../utils/shell-chrome.ts";
import {
  formatSubmitActionCue,
  type SubmitAction,
} from "../utils/submit-routing.ts";

interface FooterProps {
  streamingState?: StreamingState;
  activeTool?: { name: string; toolIndex: number; toolTotal: number };
  modelName?: string;
  runtimeModeLabel?: string;
  statusMessage?: string;
  contextUsageLabel?: string;
  modeLabel?: string;
  planningPhase?: PlanningPhase;
  interactionQueueLength?: number;
  hasDraftInput?: boolean;
  hasSubmitText?: boolean;
  inConversation?: boolean;
  isEvaluating?: boolean;
  hasPendingPermission?: boolean;
  hasPendingPlanReview?: boolean;
  hasPendingQuestion?: boolean;
  suppressInteractionHints?: boolean;
  teamActive?: boolean;
  teamAttentionCount?: number;
  teamFocusLabel?: string;
  teamWorkerSummary?: string;
  localAgentCount?: number;
  pendingInteractionLabel?: string;
  activeTaskCount?: number;
  recentActiveTaskLabel?: string;
  aiAvailable?: boolean;
  conversationQueueCount?: number;
  localEvalQueueCount?: number;
  submitAction?: SubmitAction;
}

interface FooterLeftStateInput {
  inConversation?: boolean;
  isEvaluating?: boolean;
  streamingState?: StreamingState;
  activeTool?: { name: string; toolIndex: number; toolTotal: number };
  modeLabel?: string;
  planningPhase?: PlanningPhase;
  interactionQueueLength?: number;
  hasDraftInput?: boolean;
  hasSubmitText?: boolean;
  hasPendingPermission?: boolean;
  hasPendingPlanReview?: boolean;
  hasPendingQuestion?: boolean;
  suppressInteractionHints?: boolean;
  teamActive?: boolean;
  teamAttentionCount?: number;
  teamFocusLabel?: string;
  teamWorkerSummary?: string;
  localAgentCount?: number;
  pendingInteractionLabel?: string;
  activeTaskCount?: number;
  recentActiveTaskLabel?: string;
  spinner: string;
  statusMessage?: string;
  conversationQueueCount?: number;
  localEvalQueueCount?: number;
  submitAction?: SubmitAction;
}

interface FooterLeftState {
  mode: "message" | "segments";
  segments: ShellFooterSegment[];
  text: string;
  tone: "muted" | "warning";
}

function isDefaultModeLabel(label: string | undefined): boolean {
  return !label || label === "Default mode";
}

function getQueuedInputLabel(
  conversationQueueCount = 0,
  localEvalQueueCount = 0,
): string | undefined {
  const totalCount = conversationQueueCount + localEvalQueueCount;
  if (totalCount === 0) return undefined;
  return `+${totalCount} next`;
}

export function buildFooterLeftState({
  inConversation,
  isEvaluating,
  streamingState,
  activeTool,
  modeLabel,
  planningPhase,
  interactionQueueLength = 0,
  hasDraftInput,
  hasSubmitText,
  hasPendingPermission,
  hasPendingPlanReview,
  hasPendingQuestion,
  suppressInteractionHints,
  teamActive,
  teamAttentionCount: _teamAttentionCount,
  teamFocusLabel,
  teamWorkerSummary,
  localAgentCount = 0,
  pendingInteractionLabel,
  activeTaskCount = 0,
  recentActiveTaskLabel,
  spinner,
  statusMessage,
  conversationQueueCount = 0,
  localEvalQueueCount = 0,
  submitAction,
}: FooterLeftStateInput): FooterLeftState {
  const summarizedModeLabel = summarizeModeLabel(modeLabel);
  const modeChip = planningPhase && planningPhase !== "done" &&
      summarizedModeLabel === "Plan mode"
    ? undefined
    : summarizedModeLabel;
  const queuedCount = Math.max(0, interactionQueueLength - 1);
  const suppressFooterTeamRail = localAgentCount > 0 && !teamFocusLabel;
  const teamChip: ShellFooterSegment | null =
    teamActive && !suppressFooterTeamRail
      ? { text: "Team", tone: "active" }
      : null;
  const showTeamControls = teamActive &&
    !hasDraftInput &&
    streamingState !== ConversationStreamingState.Responding;
  const teamFocusChip: ShellFooterSegment | null = teamActive && teamFocusLabel
    ? { text: `To ${teamFocusLabel}`, tone: "active" }
    : null;
  const teamWorkerSegment: ShellFooterSegment | null =
    teamActive && teamWorkerSummary && !suppressFooterTeamRail
      ? { text: teamWorkerSummary, tone: "muted" }
      : null;
  const teamCycleSegment: ShellFooterSegment | null = showTeamControls &&
      !teamWorkerSegment
    ? { text: "Shift+Down teammate", tone: "muted" }
    : null;
  const teamSessionSegment: ShellFooterSegment | null =
    showTeamControls && teamFocusLabel
      ? { text: "Enter session", tone: "muted" }
      : null;
  const teamManageSegment: ShellFooterSegment | null = showTeamControls &&
      teamWorkerSegment &&
      !suppressFooterTeamRail
    ? { text: "Ctrl+T manager", tone: "muted" }
    : null;
  const bgChip: ShellFooterSegment | null = activeTaskCount > 0
    ? {
      text: `${STATUS_GLYPHS.running} ${activeTaskCount} tasks`,
      tone: "active",
    }
    : null;
  const bgTaskHint: ShellFooterSegment | null =
    recentActiveTaskLabel && activeTaskCount > 0
      ? {
        text: `${truncate(recentActiveTaskLabel, 24)} \u00B7 Ctrl+T tasks`,
        tone: "muted",
      }
      : null;

  if (!inConversation) {
    // Status message takes precedence (mode switch flash, etc.)
    if (statusMessage) {
      return {
        mode: "message",
        segments: [],
        text: statusMessage,
        tone: "muted",
      };
    }

    const segments: ShellFooterSegment[] = [];
    const isFullAuto = modeChip === "Full auto";
    const shouldShowModeChip = !isDefaultModeLabel(modeChip);

    // Full auto gets red chip, others get plain text segment
    if (isFullAuto) {
      segments.push({ text: modeChip, tone: "error", chip: true });
    } else if (shouldShowModeChip && modeChip) {
      segments.push({ text: modeChip, tone: "muted" });
    }

    if (teamChip) segments.push(teamChip);
    if (teamFocusChip) segments.push(teamFocusChip);
    if (teamCycleSegment) segments.push(teamCycleSegment);
    if (teamSessionSegment) segments.push(teamSessionSegment);
    if (teamWorkerSegment) segments.push(teamWorkerSegment);
    if (teamManageSegment) segments.push(teamManageSegment);
    if (bgChip) segments.push(bgChip);
    if (bgTaskHint) segments.push(bgTaskHint);
    const queuedInputLabel = getQueuedInputLabel(
      conversationQueueCount,
      localEvalQueueCount,
    );
    if (queuedInputLabel) {
      segments.push({
        text: queuedInputLabel,
        tone: "active",
      });
    }
    if (hasSubmitText && submitAction) {
      segments.push({
        text: formatSubmitActionCue(submitAction, "mixed-shell"),
        tone: "active",
      });
    }

    if (isEvaluating) {
      return {
        mode: "message",
        segments: [],
        text: "Ctrl+B background \u00B7 Esc cancels",
        tone: "muted",
      };
    }

    const hintText = segments.length === 0 ? "? for shortcuts" : "";
    if (hintText) {
      segments.push({ text: hintText, tone: "muted" });
    }
    return {
      mode: "segments",
      segments,
      text: formatShellFooterText(segments),
      tone: "muted",
    };
  }

  // Warning states — keep visible since they require user action
  if (
    suppressInteractionHints && (hasPendingPlanReview || hasPendingQuestion)
  ) {
    return { mode: "message", segments: [], text: "", tone: "muted" };
  } else if (hasPendingPlanReview) {
    return {
      mode: "message",
      segments: [],
      text: pendingInteractionLabel
        ? `${pendingInteractionLabel} · Use arrows or 1-3 · Enter confirm · Esc cancel`
        : "Use arrows or 1-3 · Enter confirm · Esc cancel",
      tone: "warning",
    };
  } else if (hasPendingPermission) {
    return {
      mode: "message",
      segments: [],
      text: pendingInteractionLabel
        ? `${pendingInteractionLabel} · Enter approve · Esc cancel`
        : "Enter approve · Esc cancel",
      tone: "warning",
    };
  } else if (hasPendingQuestion) {
    return {
      mode: "message",
      segments: [],
      text: pendingInteractionLabel
        ? `${pendingInteractionLabel} · Enter submit · Tab notes · Esc cancel`
        : "Enter submit · Tab notes · Esc cancel",
      tone: "warning",
    };
  } else if (
    streamingState === ConversationStreamingState.WaitingForConfirmation
  ) {
    return {
      mode: "message",
      segments: [],
      text: "Waiting for confirmation",
      tone: "warning",
    };
  } else if (statusMessage) {
    // Status message (mode switch flash, etc.) - show after high-priority warnings
    return {
      mode: "message",
      segments: [],
      text: statusMessage,
      tone: "muted",
    };
  }

  const segments: ShellFooterSegment[] = [];
  const isFullAuto = modeChip === "Full auto";
  const shouldShowModeChip = !isDefaultModeLabel(modeChip);

  // Full auto gets red chip, others get plain text segment
  if (isFullAuto) {
    segments.push({ text: modeChip, tone: "error", chip: true });
  } else if (shouldShowModeChip && modeChip) {
    segments.push({ text: modeChip, tone: "muted" });
  }

  if (queuedCount > 0) {
    segments.push({
      text: `+${queuedCount} queued`,
      tone: "active",
    });
  }
  const queuedInputLabel = getQueuedInputLabel(
    conversationQueueCount,
    localEvalQueueCount,
  );
  if (queuedInputLabel) {
    segments.push({
      text: queuedInputLabel,
      tone: "active",
    });
  }
  if (
    hasSubmitText &&
    submitAction &&
    streamingState !== ConversationStreamingState.Responding
  ) {
    segments.push({
      text: formatSubmitActionCue(submitAction, "conversation"),
      tone: "active",
    });
  }
  if (teamChip) segments.push(teamChip);
  if (teamFocusChip) segments.push(teamFocusChip);
  if (teamCycleSegment) segments.push(teamCycleSegment);
  if (teamSessionSegment) segments.push(teamSessionSegment);
  if (teamWorkerSegment) segments.push(teamWorkerSegment);
  if (teamManageSegment) segments.push(teamManageSegment);
  if (planningPhase && planningPhase !== "done") {
    segments.push({
      text: getPlanPhaseLabel(planningPhase),
      tone: "active",
    });
  }
  if (bgChip) segments.push(bgChip);
  if (bgTaskHint) segments.push(bgTaskHint);
  if (
    streamingState === ConversationStreamingState.Responding &&
    activeTool &&
    !hasDraftInput
  ) {
    segments.push({
      text:
        `${spinner} ${activeTool.name} ${activeTool.toolIndex}/${activeTool.toolTotal}`,
      tone: "warning",
      chip: true,
    });
  }

  const hintText = streamingState === ConversationStreamingState.Responding
    ? hasDraftInput ? "Tab queues · Ctrl+Enter forces" : "Esc cancels"
    : planningPhase && planningPhase !== "done"
    ? "Esc clears plan"
    : segments.length === 0
    ? "? for shortcuts"
    : "";
  if (hintText) {
    segments.push({
      text: hintText,
      tone: hasDraftInput &&
          streamingState === ConversationStreamingState.Responding
        ? "active"
        : "muted",
    });
  }

  return {
    mode: "segments",
    segments,
    text: formatShellFooterText(segments),
    tone: "muted",
  };
}

interface FooterRightStateInput {
  modelName?: string;
  runtimeModeLabel?: string;
  contextUsageLabel?: string;
}

export function buildFooterRightState({
  modelName,
  runtimeModeLabel,
  contextUsageLabel,
}: FooterRightStateInput): { infoParts: string[]; infoText: string } {
  const usageDisplay = contextUsageLabel
    ? buildContextUsageMiniBar(contextUsageLabel)
    : undefined;
  const infoParts = [usageDisplay, runtimeModeLabel, modelName].filter(
    (part): part is string => Boolean(part && part.trim()),
  );
  return {
    infoParts,
    infoText: infoParts.join(SHELL_SEGMENT_SEPARATOR),
  };
}

export const FooterHint = React.memo(function FooterHint({
  streamingState,
  activeTool,
  modelName,
  runtimeModeLabel,
  statusMessage,
  contextUsageLabel,
  modeLabel,
  planningPhase,
  interactionQueueLength = 0,
  hasDraftInput,
  hasSubmitText,
  inConversation,
  isEvaluating,
  hasPendingPermission,
  hasPendingPlanReview,
  hasPendingQuestion,
  suppressInteractionHints,
  teamActive,
  teamAttentionCount,
  teamFocusLabel,
  teamWorkerSummary,
  localAgentCount,
  pendingInteractionLabel,
  activeTaskCount,
  recentActiveTaskLabel,
  aiAvailable = false,
  conversationQueueCount,
  localEvalQueueCount,
  submitAction,
}: FooterProps): React.ReactElement {
  const { stdout } = useStdout();
  const sc = useSemanticColors();
  const model = modelName ?? "";
  const spinner = STATUS_GLYPHS.running;

  const left = buildFooterLeftState({
    inConversation,
    isEvaluating,
    streamingState,
    activeTool,
    modeLabel,
    planningPhase,
    interactionQueueLength,
    hasDraftInput,
    hasSubmitText,
    hasPendingPermission,
    hasPendingPlanReview,
    hasPendingQuestion,
    suppressInteractionHints,
    teamActive,
    teamAttentionCount,
    teamFocusLabel,
    teamWorkerSummary,
    localAgentCount,
    pendingInteractionLabel,
    activeTaskCount,
    recentActiveTaskLabel,
    spinner,
    statusMessage,
    conversationQueueCount,
    localEvalQueueCount,
    submitAction,
  });

  const right = buildFooterRightState({
    modelName: model,
    runtimeModeLabel,
    contextUsageLabel,
  });

  const rawTerminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  const contentWidth = getShellContentWidth(rawTerminalWidth);

  // Single line: left status ... right model info
  const maxRightWidth = Math.max(8, Math.floor(contentWidth * 0.45));
  const rightText = truncate(right.infoText, maxRightWidth);
  const rightParts = rightText === right.infoText
    ? right.infoParts
    : [rightText];

  // Reserve space for right side, truncate left to fit
  // +2 accounts for the "● " health dot prefix rendered before right parts
  const rightLen = rightParts.length > 0 ? rightText.length + 2 : 0;
  const gap = 2; // minimum gap between left and right
  const leftMaxWidth = Math.max(8, contentWidth - rightLen - gap);
  const fittedSegments = left.mode === "segments"
    ? fitShellFooterSegments(left.segments, leftMaxWidth)
    : [];
  const leftText = left.mode === "message"
    ? truncate(left.text, leftMaxWidth)
    : "";

  const renderSegment = (
    segment: ShellFooterSegment,
    index: number,
  ): React.ReactElement => {
    if (segment.chip) {
      const tone = segment.tone === "error"
        ? sc.chrome.chipError
        : segment.tone === "warning"
        ? sc.shell.chipWarning
        : segment.tone === "active"
        ? sc.shell.chipActive
        : sc.shell.chipNeutral;
      return (
        <Text
          backgroundColor={tone.background}
          color={tone.foreground}
        >
          {" "}
          {segment.text}
          {" "}
        </Text>
      );
    }

    const color = segment.tone === "error"
      ? sc.status.error
      : segment.tone === "active"
      ? sc.footer.status.active
      : segment.tone === "warning"
      ? sc.status.warning
      : sc.text.muted;
    return <Text color={color}>{segment.text}</Text>;
  };

  return (
    <Box flexDirection="column">
      <Box
        flexGrow={1}
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={1}
        paddingRight={1}
      >
        <Box>
          {left.mode === "message"
            ? (
              <Text
                color={left.tone === "warning"
                  ? sc.status.warning
                  : sc.text.muted}
              >
                {leftText}
              </Text>
            )
            : fittedSegments.map((segment, index) => (
              <React.Fragment key={`${segment.text}-${index}`}>
                {index > 0 && (
                  <Text color={sc.shell.separator}>
                    {SHELL_SEGMENT_SEPARATOR}
                  </Text>
                )}
                {renderSegment(segment, index)}
              </React.Fragment>
            ))}
        </Box>
        {rightParts.length > 0 && (
          <Box>
            <Text
              color={aiAvailable
                ? sc.footer.status.ready
                : sc.footer.status.error}
            >
              {STATUS_GLYPHS.running}
              {" "}
            </Text>
            {rightParts.map((part, index) => (
              <React.Fragment key={`${part}-${index}`}>
                {index > 0 && (
                  <Text color={sc.shell.separator}>
                    {SHELL_SEGMENT_SEPARATOR}
                  </Text>
                )}
                <Text color={sc.text.muted}>{part}</Text>
              </React.Fragment>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
});
