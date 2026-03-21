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
import {
  type StreamingState,
  StreamingState as ConversationStreamingState,
} from "../types.ts";
import { DEFAULT_TERMINAL_WIDTH } from "../ui-constants.ts";
import { STATUS_GLYPHS } from "../ui-constants.ts";

import { truncate } from "../../../../common/utils.ts";
import { useConversationSpinnerFrame } from "../hooks/useConversationMotion.ts";
import {
  fitShellFooterSegments,
  formatShellFooterText,
  SHELL_SEGMENT_SEPARATOR,
  type ShellFooterSegment,
  summarizeModeLabel,
} from "../utils/shell-chrome.ts";

interface FooterProps {
  streamingState?: StreamingState;
  activeTool?: { name: string; toolIndex: number; toolTotal: number };
  modelName?: string;
  statusMessage?: string;
  contextUsageLabel?: string;
  modeLabel?: string;
  interactionQueueLength?: number;
  hasDraftInput?: boolean;
  inConversation?: boolean;
  hasPendingPermission?: boolean;
  hasPendingPlanReview?: boolean;
  hasPendingQuestion?: boolean;
  suppressInteractionHints?: boolean;
  teamActive?: boolean;
  teamAttentionCount?: number;
}

interface FooterLeftStateInput {
  inConversation?: boolean;
  streamingState?: StreamingState;
  activeTool?: { name: string; toolIndex: number; toolTotal: number };
  modeLabel?: string;
  interactionQueueLength?: number;
  hasDraftInput?: boolean;
  hasPendingPermission?: boolean;
  hasPendingPlanReview?: boolean;
  hasPendingQuestion?: boolean;
  suppressInteractionHints?: boolean;
  teamActive?: boolean;
  teamAttentionCount?: number;
  spinner: string;
  statusMessage?: string;
}

interface FooterLeftState {
  mode: "message" | "segments";
  segments: ShellFooterSegment[];
  text: string;
  tone: "muted" | "warning";
}

export function buildFooterLeftState({
  inConversation,
  streamingState,
  activeTool,
  modeLabel,
  interactionQueueLength = 0,
  hasDraftInput,
  hasPendingPermission,
  hasPendingPlanReview,
  hasPendingQuestion,
  suppressInteractionHints,
  teamActive,
  teamAttentionCount,
  spinner,
  statusMessage,
}: FooterLeftStateInput): FooterLeftState {
  const modeChip = summarizeModeLabel(modeLabel);
  const queuedCount = Math.max(0, interactionQueueLength - 1);
  const teamHint = teamActive && teamAttentionCount && teamAttentionCount > 0
    ? `Ctrl+T (${teamAttentionCount})`
    : "";

  if (!inConversation) {
    const segments: ShellFooterSegment[] = [];
    if (modeChip) {
      segments.push({ text: modeChip, tone: "neutral", chip: true });
    }
    const hintText = statusMessage ||
      (modeChip ? "Shift+Tab cycles" : "") ||
      "";
    const combinedHint = [hintText, teamHint].filter(Boolean).join(
      SHELL_SEGMENT_SEPARATOR,
    );
    if (combinedHint) {
      segments.push({ text: combinedHint, tone: "muted" });
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
      text: "Use arrows or 1-3 · Enter confirm · Esc cancel",
      tone: "warning",
    };
  } else if (hasPendingPermission) {
    return {
      mode: "message",
      segments: [],
      text: "Enter approve · Esc cancel",
      tone: "warning",
    };
  } else if (hasPendingQuestion) {
    return {
      mode: "message",
      segments: [],
      text: "Enter submit · Tab notes · Esc cancel",
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
  }

  const segments: ShellFooterSegment[] = [];
  if (modeChip) {
    segments.push({ text: modeChip, tone: "neutral", chip: true });
  }
  if (queuedCount > 0) {
    segments.push({
      text: `+${queuedCount} queued`,
      tone: "active",
      chip: true,
    });
  }
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
    : statusMessage || (modeChip ? "Shift+Tab cycles" : "") || "";
  const combinedHint = [hintText, teamHint].filter(Boolean).join(
    SHELL_SEGMENT_SEPARATOR,
  );
  if (combinedHint) {
    segments.push({
      text: combinedHint,
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
  contextUsageLabel?: string;
}

export function buildFooterRightState({
  modelName,
  contextUsageLabel,
}: FooterRightStateInput): { infoParts: string[]; infoText: string } {
  const infoParts = [contextUsageLabel, modelName].filter(
    (part): part is string => Boolean(part && part.trim()),
  );
  return {
    infoParts,
    infoText: infoParts.join(SHELL_SEGMENT_SEPARATOR),
  };
}

export function FooterHint({
  streamingState,
  activeTool,
  modelName,
  statusMessage,
  contextUsageLabel,
  modeLabel,
  interactionQueueLength = 0,
  hasDraftInput,
  inConversation,
  hasPendingPermission,
  hasPendingPlanReview,
  hasPendingQuestion,
  suppressInteractionHints,
  teamActive,
  teamAttentionCount,
}: FooterProps): React.ReactElement {
  const { stdout } = useStdout();
  const sc = useSemanticColors();
  const model = modelName ?? "";
  const isAnimating =
    streamingState === ConversationStreamingState.Responding &&
    !!activeTool;
  const spinnerFrame = useConversationSpinnerFrame(isAnimating);
  const spinner = spinnerFrame ?? STATUS_GLYPHS.running;

  const left = buildFooterLeftState({
    inConversation,
    streamingState,
    activeTool,
    modeLabel,
    interactionQueueLength,
    hasDraftInput,
    hasPendingPermission,
    hasPendingPlanReview,
    hasPendingQuestion,
    suppressInteractionHints,
    teamActive,
    teamAttentionCount,
    spinner,
    statusMessage,
  });

  const right = buildFooterRightState({
    modelName: model,
    contextUsageLabel,
  });

  const rawTerminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  const contentWidth = Math.max(20, rawTerminalWidth - 2);

  // Single line: left status ... right model info
  const maxRightWidth = Math.max(8, Math.floor(contentWidth * 0.45));
  const rightText = truncate(right.infoText, maxRightWidth);
  const rightParts = rightText === right.infoText
    ? right.infoParts
    : [rightText];

  // Reserve space for right side, truncate left to fit
  const rightLen = rightText.length;
  const gap = 2; // minimum gap between left and right
  const leftMaxWidth = Math.max(8, contentWidth - rightLen - gap);
  const separator = "─".repeat(contentWidth);
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
      const tone = segment.tone === "warning"
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

    const color = segment.tone === "active"
      ? sc.shell.chipActive.background
      : segment.tone === "warning"
      ? sc.status.warning
      : sc.text.muted;
    return <Text color={color}>{segment.text}</Text>;
  };

  return (
    <Box flexDirection="column">
      <Text color={sc.shell.separator}>{separator}</Text>
      <Box
        flexGrow={1}
        flexDirection="row"
        justifyContent="space-between"
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
}
