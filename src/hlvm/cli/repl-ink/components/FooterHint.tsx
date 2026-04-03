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
import { useConversationSpinnerFrame } from "../hooks/useConversationMotion.ts";

interface FooterProps {
  streamingState?: StreamingState;
  activeTool?: {
    name: string;
    displayName: string;
    progressText?: string;
    progressTone?: "running" | "success" | "warning";
    toolIndex: number;
    toolTotal: number;
  };
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
  activeTool?: {
    name: string;
    displayName: string;
    progressText?: string;
    progressTone?: "running" | "success" | "warning";
    toolIndex: number;
    toolTotal: number;
  };
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

/** Constant returned when the footer should yield to another surface (dialog, etc.). */
const EMPTY_FOOTER: FooterLeftState = Object.freeze({
  mode: "message" as const,
  segments: [] as ShellFooterSegment[],
  text: "",
  tone: "muted" as const,
});

/** Push a mode-chip segment (e.g. "Full auto", "Plan mode") into `segments`. */
function pushModeChipSegment(
  segments: ShellFooterSegment[],
  modeChip: string | undefined,
): void {
  const isFullAuto = modeChip === "Full auto";
  if (isFullAuto) {
    segments.push({ text: modeChip, tone: "error", chip: true });
  } else if (!isDefaultModeLabel(modeChip) && modeChip) {
    segments.push({ text: modeChip, tone: "muted" });
  }
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

  if (!inConversation) {
    // Status message takes precedence (mode switch flash, etc.)
    if (statusMessage) {
      return { mode: "message", segments: [], text: statusMessage, tone: "muted" };
    }

    const segments: ShellFooterSegment[] = [];
    pushModeChipSegment(segments, modeChip);

    const queuedInputLabel = getQueuedInputLabel(
      conversationQueueCount,
      localEvalQueueCount,
    );
    if (queuedInputLabel) {
      segments.push({ text: queuedInputLabel, tone: "active" });
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

    if (segments.length === 0) {
      segments.push({ text: "? for shortcuts", tone: "muted" });
    }
    return {
      mode: "segments",
      segments,
      text: formatShellFooterText(segments),
      tone: "muted",
    };
  }

  // Warning / interaction states — yield to the dialog surface
  const suppressedByPicker = suppressInteractionHints &&
    (hasPendingPlanReview || hasPendingQuestion);
  if (
    suppressedByPicker || hasPendingPlanReview || hasPendingPermission ||
    hasPendingQuestion ||
    streamingState === ConversationStreamingState.WaitingForConfirmation
  ) {
    return EMPTY_FOOTER;
  }

  // Status message (mode switch flash, etc.) - show after high-priority warnings
  if (statusMessage) {
    return { mode: "message", segments: [], text: statusMessage, tone: "muted" };
  }

  const segments: ShellFooterSegment[] = [];
  pushModeChipSegment(segments, modeChip);

  if (queuedCount > 0) {
    segments.push({ text: `+${queuedCount} queued`, tone: "active" });
  }
  const queuedInputLabel = getQueuedInputLabel(
    conversationQueueCount,
    localEvalQueueCount,
  );
  if (queuedInputLabel) {
    segments.push({ text: queuedInputLabel, tone: "active" });
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
  if (planningPhase && planningPhase !== "done") {
    segments.push({ text: getPlanPhaseLabel(planningPhase), tone: "active" });
  }
  if (
    streamingState === ConversationStreamingState.Responding &&
    activeTool &&
    !hasDraftInput
  ) {
    const activeToolLabel = `${spinner} ${activeTool.displayName} ${
      activeTool.toolIndex
    }/${activeTool.toolTotal}`;
    const activeToolProgress = activeTool.progressText?.trim()
      ? ` · ${truncate(activeTool.progressText.trim(), 28)}`
      : "";
    segments.push({
      text: `${activeToolLabel}${activeToolProgress}`,
      tone: activeTool.progressTone === "warning" ? "warning" : "active",
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
  const spinner = useConversationSpinnerFrame(
    streamingState === ConversationStreamingState.Responding,
  ) ?? STATUS_GLYPHS.running;

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
