/**
 * Footer Hint Component
 *
 * Single-line hints-only footer (below TuiStatusLine):
 * - Shows context-aware status / action hints
 * - Model info / context usage is rendered by TuiStatusLine
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { useSemanticColors } from "../../theme/index.ts";
import type { PlanningPhase } from "../../../agent/planning.ts";
import {
  type StreamingState,
  StreamingState as ConversationStreamingState,
} from "../types.ts";
import { DEFAULT_TERMINAL_WIDTH } from "../ui-constants.ts";
import { getShellContentWidth } from "../utils/layout-tokens.ts";

import { truncate } from "../../../../common/utils.ts";
import { getPlanPhaseLabel } from "./conversation/plan-flow.ts";
import {
  fitShellFooterSegments,
  formatShellFooterText,
  SHELL_SEGMENT_SEPARATOR,
  type ShellFooterSegment,
} from "../utils/shell-chrome.ts";
import {
  formatSubmitActionCue,
  type SubmitAction,
} from "../utils/submit-routing.ts";

interface FooterProps {
  streamingState?: StreamingState;
  statusMessage?: string;
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
  conversationQueueCount?: number;
  localEvalQueueCount?: number;
  submitAction?: SubmitAction;
  backgroundLabel?: string;
  backgroundHintLabel?: string;
}

interface FooterLeftStateInput {
  inConversation?: boolean;
  isEvaluating?: boolean;
  streamingState?: StreamingState;
  planningPhase?: PlanningPhase;
  interactionQueueLength?: number;
  hasDraftInput?: boolean;
  hasSubmitText?: boolean;
  hasPendingPermission?: boolean;
  hasPendingPlanReview?: boolean;
  hasPendingQuestion?: boolean;
  suppressInteractionHints?: boolean;
  statusMessage?: string;
  conversationQueueCount?: number;
  localEvalQueueCount?: number;
  submitAction?: SubmitAction;
  backgroundLabel?: string;
  backgroundHintLabel?: string;
}

interface FooterLeftState {
  mode: "message" | "segments";
  segments: ShellFooterSegment[];
  text: string;
  tone: "muted" | "warning";
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
  planningPhase,
  interactionQueueLength = 0,
  hasDraftInput,
  hasSubmitText,
  hasPendingPermission,
  hasPendingPlanReview,
  hasPendingQuestion,
  suppressInteractionHints,
  statusMessage,
  conversationQueueCount = 0,
  localEvalQueueCount = 0,
  submitAction,
  backgroundLabel,
  backgroundHintLabel,
}: FooterLeftStateInput): FooterLeftState {
  const queuedCount = Math.max(0, interactionQueueLength - 1);

  if (!inConversation) {
    // Status message takes precedence (mode switch flash, etc.)
    if (statusMessage) {
      return { mode: "message", segments: [], text: statusMessage, tone: "muted" };
    }

    const segments: ShellFooterSegment[] = [];

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
        text: "Ctrl+B background · Esc cancel",
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

  const segments: ShellFooterSegment[] = [];

  if (
    hasPendingPlanReview || hasPendingPermission || hasPendingQuestion ||
    streamingState === ConversationStreamingState.WaitingForConfirmation
  ) {
    segments.push({
      text: hasPendingPlanReview
        ? "Plan review"
        : hasPendingQuestion
        ? "Reply needed"
        : "Permission needed",
      tone: "warning",
      chip: true,
    });
    if (queuedCount > 0) {
      segments.push({ text: `+${queuedCount} queued`, tone: "active" });
    }
    const interactionHint = suppressInteractionHints
      ? "↑/↓ / 1-9 · Enter submit · Esc"
      : hasPendingQuestion
      ? "Type reply · Enter submit · Esc"
      : "Enter submit · Esc";
    segments.push({ text: interactionHint, tone: "muted" });
    return {
      mode: "segments",
      segments,
      text: formatShellFooterText(segments),
      tone: "muted",
    };
  }

  // Status message (mode switch flash, etc.) - show after high-priority warnings
  if (statusMessage) {
    return { mode: "message", segments: [], text: statusMessage, tone: "muted" };
  }

  if (queuedCount > 0) {
    segments.push({ text: `+${queuedCount} queued`, tone: "active" });
  }
  if (backgroundLabel) {
    segments.push({ text: backgroundLabel, tone: "active" });
  }
  if (backgroundHintLabel) {
    segments.push({ text: backgroundHintLabel, tone: "muted" });
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

  const idleHint = "Ctrl+O history · ? shortcuts";
  const hintText = streamingState === ConversationStreamingState.Responding
    ? hasDraftInput ? "Tab queue · Ctrl+Enter send" : "Esc cancel"
    : planningPhase && planningPhase !== "done"
    ? "Esc clear plan"
    : segments.length === 0
    ? idleHint
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

export const FooterHint = React.memo(function FooterHint({
  streamingState,
  statusMessage,
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
  conversationQueueCount,
  localEvalQueueCount,
  submitAction,
  backgroundLabel,
  backgroundHintLabel,
}: FooterProps): React.ReactElement {
  const { stdout } = useStdout();
  const sc = useSemanticColors();

  const left = buildFooterLeftState({
    inConversation,
    isEvaluating,
    streamingState,
    planningPhase,
    interactionQueueLength,
    hasDraftInput,
    hasSubmitText,
    hasPendingPermission,
    hasPendingPlanReview,
    hasPendingQuestion,
    suppressInteractionHints,
    statusMessage,
    conversationQueueCount,
    localEvalQueueCount,
    submitAction,
    backgroundLabel,
    backgroundHintLabel,
  });

  const rawTerminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  const contentWidth = getShellContentWidth(rawTerminalWidth);

  // Hints-only line — right side is handled by TuiStatusLine above
  const leftMaxWidth = Math.max(8, contentWidth - 2);
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
    <Box paddingLeft={1} paddingRight={1}>
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
  );
});
